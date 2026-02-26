// /reviews-launch/index.js  (resilient, with per-item guards)
const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const { customAlphabet } = require("nanoid");
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });

const schema = {
  type: "object",
  required: ["appId"],
  properties: {
    appId: { type: "string", minLength: 1 },
    dueDate: { type: "string" },
    name: { type: "string" },
    launchIfExists: { type: "boolean" }
  },
  additionalProperties: true
};
const validate = ajv.compile(schema);

// Normalizes values for stable comparisons (e.g., SoD entitlement matching)
const SAFE = (s) => String(s || "").trim().replace(/\s+/g, "_").replace(/[^\w\-]/g, "").toUpperCase();

module.exports = async function (context, req) {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    // Validate request payload
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) return bad(400, ajv.errorsText(validate.errors), req);

    // Initialize Cosmos dependencies
    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");

    const accountsC = db.container("accounts");       // PK: /appId
    const hrC = db.container("hrUsers");              // PK: /userId
    const sodC = db.container("sodPolicies");         // PK: /policyId
    const cyclesC = db.container("reviewCycles");     // PK: /appId
    const itemsC = db.container("reviewItems");       // PK: /managerId
    const logsC = db.container("auditLogs");
    const appsC = db.container("applications");

    const now = new Date();
    const nowIso = now.toISOString();
    const appId = body.appId.trim();
    const appIdSafe = SAFE(appId);
    const dueDate = body.dueDate
      ? new Date(body.dueDate).toISOString()
      : new Date(now.getTime() + 14 * 86400000).toISOString();

    // Attempts app lookup by both id and appId to support mixed catalog schemas
    async function readAppByIdOrAppId(targetAppId) {
      try {
        const { resource } = await appsC.item(targetAppId, targetAppId).read();
        if (resource) return resource;
      } catch (_) {
      }
      try {
        const { resources } = await appsC.items.query({
          query: "SELECT TOP 1 * FROM c WHERE c.appId=@a OR c.id=@a",
          parameters: [{ name: "@a", value: targetAppId }]
        }).fetchAll();
        return resources?.[0] || null;
      } catch (_) {
        return null;
      }
    }

    // Resolve display app name for cycle/item records
    async function resolveAppName(targetAppId, bodyName) {
      const appMeta = await readAppByIdOrAppId(targetAppId);
      if (appMeta) {
        const candidate = appMeta.name || appMeta.appName || appMeta.displayName || appMeta.title;
        if (candidate && String(candidate).trim().length > 0) return String(candidate).trim();
      }
      if (bodyName && String(bodyName).trim().length > 0) return String(bodyName).trim();
      return targetAppId;
    }

    // Resolve fallback reviewer when HR manager is missing; prefers actual app owner in HR
    async function resolveAppOwnerManagerId(targetAppId, targetAppIdSafe) {
      const appMeta = await readAppByIdOrAppId(targetAppId);

      const candidates = [];
      const directOwner = appMeta?.ownerUserId || appMeta?.ownerId || null;
      const directEmail = appMeta?.ownerEmail || null;
      const directName = appMeta?.ownerName || appMeta?.ownerDisplayName || null;

      if (directOwner) candidates.push({ userId: String(directOwner).trim() });
      if (directEmail) candidates.push({ email: String(directEmail).trim().toLowerCase() });
      if (directName) candidates.push({ name: String(directName).trim() });

      if (Array.isArray(appMeta?.owners)) {
        for (const owner of appMeta.owners) {
          if (!owner) continue;
          if (owner.userId) candidates.push({ userId: String(owner.userId).trim() });
          if (owner.email) candidates.push({ email: String(owner.email).trim().toLowerCase() });
          if (owner.name) candidates.push({ name: String(owner.name).trim() });
        }
      }

      if (candidates.length === 0) return `OWNER_${targetAppIdSafe}`;

      for (const candidate of candidates) {
        if (!candidate.userId) continue;
        try {
          const uid = String(candidate.userId).trim();
          if (!uid) continue;
          const { resource: hr } = await hrC.item(uid, uid).read();
          if (hr && hr.userId) return String(hr.userId).trim();
        } catch (_) {
        }
      }

      for (const candidate of candidates) {
        if (!candidate.email) continue;
        try {
          const email = String(candidate.email).trim().toLowerCase();
          if (!email) continue;
          const { resources: hits } = await hrC.items.query({
            query: "SELECT TOP 1 c.userId FROM c WHERE LOWER(c.email)=@e",
            parameters: [{ name: "@e", value: email }]
          }).fetchAll();
          if (hits?.length && hits[0]?.userId) return String(hits[0].userId).trim();
        } catch (_) {
        }
      }

      for (const candidate of candidates) {
        if (!candidate.name) continue;
        try {
          const name = String(candidate.name).trim();
          if (!name) continue;
          const { resources: hits } = await hrC.items.query({
            query: "SELECT TOP 1 c.userId FROM c WHERE c.name=@n",
            parameters: [{ name: "@n", value: name }]
          }).fetchAll();
          if (hits?.length && hits[0]?.userId) return String(hits[0].userId).trim();
        } catch (_) {
        }
      }

      return `OWNER_${targetAppIdSafe}`;
    }

    // Block duplicate non-completed cycles unless caller explicitly overrides
    if (!body.launchIfExists) {
      const { resources: existing } = await cyclesC.items.query({
        query: "SELECT TOP 1 * FROM c WHERE c.appId=@a AND c.status <> 'COMPLETED'",
        parameters: [{ name: "@a", value: appId }]
      }).fetchAll();
      if (existing.length > 0) {
        return bad(409, `Cycle already exists for appId=${appId} (not completed). Pass launchIfExists=true to force.`, req);
      }
    }

    // Load all accounts under this app (campaign scope)
    const { resources: accounts } = await accountsC.items.query({
      query: "SELECT c.userId, c.userName, c.email, c.entitlement, c.isOrphan, c.correlatedUserId, c.appId FROM c WHERE c.appId=@a",
      parameters: [{ name: "@a", value: appId }]
    }).fetchAll();

    if (accounts.length === 0) return bad(400, `No accounts found for appId=${appId}`, req);

    // Build lightweight HR cache for manager resolution and orphan detection
    const uniqueUserIds = Array.from(new Set(accounts.map(account => account.userId).filter(Boolean)));
    const hrCache = new Map();
    const BATCH = 50;
    for (let i = 0; i < uniqueUserIds.length; i += BATCH) {
      const chunk = uniqueUserIds.slice(i, i + BATCH);
      await Promise.all(chunk.map(async userId => {
        try {
          const { resource: hr } = await hrC.item(userId, userId).read();
          if (hr) hrCache.set(userId, hr);
        } catch (_) {
        }
      }));
    }

    // Pre-load SoD policies and compute per-user entitlements for conflict checks
    const { resources: policies } = await sodC.items.query("SELECT * FROM c").fetchAll();
    const perUserEnts = new Map();
    for (const account of accounts) {
      const arr = perUserEnts.get(account.userId) || [];
      arr.push({ appId: account.appId, entitlement: account.entitlement });
      perUserEnts.set(account.userId, arr);
    }

    // Returns policy IDs violated by a given user/account entitlement
    const conflictsFor = (userId, appIdX, entX) => {
      const userEnts = perUserEnts.get(userId) || [];
      const hits = [];
      for (const policy of policies) {
        const has1 = userEnts.some(entry => entry.appId === policy.appId1 && SAFE(entry.entitlement) === SAFE(policy.entitlement1));
        const has2 = userEnts.some(entry => entry.appId === policy.appId2 && SAFE(entry.entitlement) === SAFE(policy.entitlement2));
        if (has1 && has2) {
          if ((appIdX === policy.appId1 && SAFE(entX) === SAFE(policy.entitlement1)) ||
              (appIdX === policy.appId2 && SAFE(entX) === SAFE(policy.entitlement2))) {
            hits.push(policy.id || policy.policyId);
          }
        }
      }
      return hits;
    };

    // Create cycle header first, then fan out review item creation
    const stamp = nowIso.slice(0, 19).replace(/[-:T]/g, "");
    const cycleId = `CYC_${appIdSafe}_${stamp}_${nanoid()}`;
    const appNameResolved = await resolveAppName(appId, body.name);
    const cycleName = `Manager Campaign - ${appNameResolved} - ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
    const total = accounts.length;

    await cyclesC.items.upsert({
      id: cycleId,
      cycleId,
      name: cycleName,
      appId,
      appName: appNameResolved,
      status: "ACTIVE",
      totalItems: total,
      pendingItems: total,
      launchedAt: nowIso,
      dueDate,
      confirmedManagers: [],
      type: "review-cycle"
    });

    // Create review items in batches, while collecting per-item errors (partial success supported)
    let seq = 1;
    let created = 0;
    const errors = [];
    for (let i = 0; i < accounts.length; i += BATCH) {
      const chunk = accounts.slice(i, i + BATCH);
      await Promise.all(chunk.map(async (account, idx) => {
        try {
          const hr = account.userId ? hrCache.get(account.userId) : null;

          let managerId;
          // Manager priority: HR manager -> app owner mapped to HR -> OWNER fallback token
          if (hr && hr.managerId && String(hr.managerId).trim().length > 0) {
            managerId = String(hr.managerId).trim();
          } else {
            managerId = await resolveAppOwnerManagerId(account.appId, appIdSafe);
          }
          if (!managerId || String(managerId).trim().length === 0) {
            managerId = `OWNER_${appIdSafe}`;
          }

          const conflictIds = conflictsFor(account.userId, account.appId, account.entitlement);

          // Item payload is shaped for manager-portal rendering and action lifecycle tracking
          const item = {
            id: `ITM_${cycleId}-${String(seq++).padStart(5, "0")}`,
            reviewCycleId: cycleId,
            managerId,
            appId: account.appId,
            appName: appNameResolved,
            appUserId: account.userId,
            userName: account.userName || null,
            entitlement: account.entitlement,
            status: "PENDING",
            isOrphan: !hr || !!account.isOrphan,
            isSoDConflict: conflictIds.length > 0,
            violatedPolicyIds: conflictIds,
            createdAt: nowIso,
            actionedAt: null,
            remediatedAt: null,
            comment: null,
            type: "review-item"
          };

          await itemsC.items.upsert(item);
          created++;
        } catch (error) {
          errors.push({
            index: i + idx,
            userId: account.userId,
            entitlement: account.entitlement,
            error: error.message || String(error)
          });
        }
      }));
    }

    // Write launch audit record
    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: actorId,
      userName: actorName,
      timestamp: nowIso,
      action: "REVIEW_LAUNCH",
      details: `cycleId=${cycleId}; appId=${appId}; appName=${appNameResolved}; itemsCreated=${created}; errors=${errors.length}`,
      type: "audit"
    });

    // Return summary + diagnostics for UI/ops observability
    const counts = {
      accounts: accounts.length,
      hrUsersMatched: Array.from(hrCache.keys()).length,
      sodPolicies: policies.length
    };

    const bodyOut = {
      cycleId,
      appId,
      appName: appNameResolved,
      itemsCreated: created,
      pending: created,
      status: "ACTIVE",
      counts
    };

    return errors.length
      ? { status: 207, headers: cors(req), body: { ok: false, ...bodyOut, errors } }
      : { status: 200, headers: cors(req), body: { ok: true, ...bodyOut } };
  } catch (err) {
    // Defensive catch for unexpected runtime failures
    return bad(500, err?.message || "Internal error", req);
  }
};

// Shared CORS headers
function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name"
  };
}

// Standardized error response helper
function bad(status, error, req) {
  return { status, headers: cors(req), body: { ok: false, error } };
}
