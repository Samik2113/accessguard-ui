const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });

/**
 * Expected record:
 * {
 *   appId: "SAP",
 *   userId: "USR001",
 *   entitlement: "FI_VIEW",
 *   name: "John",
 *   email: "john@contoso.com"
 * }
 */
const entitlementSchema = {
  type: "object",
  required: ["appId", "userId", "entitlement"],
  additionalProperties: true,
  properties: {
    appId: { type: "string", minLength: 1 },
    userId: { type: "string", minLength: 1 },
    entitlement: { type: "string", minLength: 1 },
    name: { type: "string" },
    email: { type: "string" }
  }
};
const validateEntitlement = ajv.compile(entitlementSchema);

/** Utility: run operations in batches with partial successes */
async function runBatches(items, batchSize, fn) {
  let ok = 0, fail = 0, errors = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const slice = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(slice.map(fn));

    results.forEach((r, idx) => {
      if (r.status === "fulfilled") {
        ok++;
      } else {
        fail++;
        errors.push({
          index: i + idx,
          key: slice[idx]?.id || slice[idx]?.accountId,
          error: r.reason?.message || String(r.reason)
        });
      }
    });
  }
  return { ok, fail, errors };
}

module.exports = async function (context, req) {
  try {
    /** Handle CORS */
    if (req.method === "OPTIONS") {
      return { status: 204, headers: cors(req) };
    }
    if (req.method !== "POST") {
      return {
        status: 405,
        headers: cors(req),
        body: { ok: false, error: "MethodNotAllowed" }
      };
    }

    /** Validate environment */
    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      return { status: 500, headers: cors(req), body: { ok: false, error: "COSMOS_CONN not set" } };
    }

    /** Config flags */
    const ALLOW_EMPTY = (process.env.ALLOW_EMPTY_IMPORT || "false").toLowerCase() === "true";
    const BLOCK_UNCORRELATED = (process.env.BLOCK_UNCORRELATED || "false").toLowerCase() === "true";
    const SOD_BLOCK_ON_CONFLICT = (process.env.SOD_BLOCK_ON_CONFLICT || "false").toLowerCase() === "true";
    const SOD_SCOPE = (process.env.SOD_SCOPE || "app").toLowerCase(); // app|global
    const SOD_PORTAL_URL = (process.env.SOD_PORTAL_URL || "").replace(/\/+$/, "");

    /** Parse payload */
    const payload = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || []);
    if (!Array.isArray(payload)) {
      return { status: 400, headers: cors(req), body: { ok: false, error: "Body must be an array" } };
    }
    if (payload.length === 0 && !ALLOW_EMPTY) {
      return { status: 400, headers: cors(req), body: { ok: false, error: "Body must be a non-empty array" } };
    }

    /** Connect to Cosmos */
    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const accountsC = db.container("accounts");
    const hrC = db.container("hrUsers");
    const sodC = db.container("sodPolicies");
    const logsC = db.container("auditLogs");

    const now = new Date().toISOString();
    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";

    /** Validate each row */
    let appIdOfBatch;
    const byId = new Map();
    for (let i = 0; i < payload.length; i++) {
      const row = { ...(payload[i] || {}) };
      if (!validateEntitlement(row)) {
        return {
          status: 400,
          headers: cors(req),
          body: {
            ok: false,
            error: `Schema validation failed at row ${i}: ${ajv.errorsText(validateEntitlement.errors)}`
          }
        };
      }

      row.appId = row.appId.trim();
      row.userId = row.userId.trim();
      row.entitlement = row.entitlement.trim();

      if (!appIdOfBatch) appIdOfBatch = row.appId;
      if (row.appId !== appIdOfBatch) {
        return {
          status: 400,
          headers: cors(req),
          body: { ok: false, error: `Mixed appId detected. Expected '${appIdOfBatch}', got '${row.appId}'` }
        };
      }

      /** Deterministic ID */
      const id = `${row.userId}_${row.appId}_${row.entitlement}`;
      byId.set(id, { row, id });
    }

    /** Support empty-import clearing */
    if (!appIdOfBatch && payload.length === 0) {
      const provided = req.query?.appId || req.headers["x-app-id"];
      if (!provided) {
        return {
          status: 400,
          headers: cors(req),
          body: { ok: false, error: "Empty uploads require ?appId= OR x-app-id" }
        };
      }
      appIdOfBatch = String(provided).trim();
    }

    /** Build skeleton docs */
    const docs = Array.from(byId.values()).map(({ row, id }) => ({
      ...row,
      id,
      createdAt: row.createdAt || now,
      updatedAt: now,
      type: "account"
    }));

    /** Distinct users */
    const users = [...new Set(docs.map(d => d.userId))];

    /** HR correlation cache */
    const hrCache = new Map();
    await Promise.allSettled(users.map(async u => {
      const hr = await getHrUser(hrC, u);
      hrCache.set(u, hr);
    }));

    /** Existing entitlements (for SoD scope=app or global) */
    const existingByUser = new Map();
    await Promise.allSettled(users.map(async u => {
      const set = await getExistingEntitlements(accountsC, u, appIdOfBatch, SOD_SCOPE);
      existingByUser.set(u, set);
    }));

    /** Load SoD policies */
    const policies = await loadSodPolicies(sodC, appIdOfBatch);

    /** Batch entitlements per user (from this upload) */
    const batchEntitlements = groupByUserEntitlement(docs);

    /** Build final docs (including correlation + sod + isOrphan) */
    const finalDocs = [];
    let blockedUncorrelated = 0;
    let blockedSod = 0;
    const successUpsertIDs = [];

    for (const doc of docs) {
      const hr = hrCache.get(doc.userId);

      /** Build correlation */
      const correlation = buildCorrelation(hr, now);
      const isOrphan = !correlation.isCorrelated;

      /** Merge existing + new entitlements */
      const merged = new Set([
        ...(existingByUser.get(doc.userId) || []),
        ...(batchEntitlements.get(doc.userId) || [])
      ]);

      /** SoD checks */
      const conflicts = computeSodConflicts(doc.entitlement, merged, policies, SOD_PORTAL_URL);
      const sod = {
        hasConflict: conflicts.length > 0,
        conflicts,
        checkedAt: now
      };

      /** Blocking logic */
      if (BLOCK_UNCORRELATED && isOrphan) {
        blockedUncorrelated++;
        continue;
      }
      if (SOD_BLOCK_ON_CONFLICT && sod.hasConflict) {
        blockedSod++;
        continue;
      }

      /** Push final doc */
      finalDocs.push({
        ...doc,
        correlation,
        sod,
        isOrphan
      });
    }

    /** Step 1 — Upsert */
    const upsertOne = async d => {
      await accountsC.items.upsert(d);
      successUpsertIDs.push(d.id);
      return true;
    };
    const { ok: upOk, fail: upFail, errors: upErrors } = await runBatches(finalDocs, 50, upsertOne);

    /** Step 2 — Sync Delete (only consider succeeded upserts) */
    const uploadedIds = new Set(successUpsertIDs);
    const existingIdsForApp = await listIdsForApp(accountsC, appIdOfBatch);
    const toDelete = existingIdsForApp.filter(id => !uploadedIds.has(id));

    const deleteOne = async id => {
      await accountsC.item(id, appIdOfBatch).delete();
      return true;
    };
    const { ok: delOk, fail: delFail, errors: delErrors } = await runBatches(toDelete, 50, deleteOne);

    /** Step 3 — Audit log */
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      type: "audit",
      action: "ACCOUNTS_IMPORT_SYNC",
      timestamp: now,
      userId: actorId,
      userName: actorName,
      details: `appId=${appIdOfBatch}; upserted=${upOk}; upsert_failed=${upFail}; deleted=${delOk}; delete_failed=${delFail}; blocked_uncorrelated=${blockedUncorrelated}; blocked_sod=${blockedSod}`
    });

    /** Response */
    return {
      status: (upFail || delFail || blockedUncorrelated || blockedSod) ? 207 : 200,
      headers: cors(req),
      body: {
        ok: !(upFail || delFail || blockedUncorrelated || blockedSod),
        appId: appIdOfBatch,
        upserted: upOk,
        upsertFailed: upFail,
        deleted: delOk,
        deleteFailed: delFail,
        blockedUncorrelated,
        blockedSod,
        upsertErrors: upErrors,
        deleteErrors: delErrors
      }
    };

  } catch (err) {
    context.log.error("ENTITLEMENTS IMPORT - ERROR:", err);
    return { status: 500, headers: cors(req), body: { ok: false, error: err.message || "Internal error" } };
  }
};

/* ------------------------------ Helpers ------------------------------ */

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name, x-app-id"
  };
}

/** HR correlation lookup */
async function getHrUser(hrC, userId) {
  try {
    const { resource } = await hrC.item(userId, userId).read();
    return resource || null;
  } catch (e) {
    if (e.code === 404) return null;
    throw e;
  }
}

function buildCorrelation(hr, now) {
  if (!hr) {
    return {
      isCorrelated: false,
      status: "NotFound",
      checkedAt: now
    };
  }
  const status = normalizeStatus(hr);
  return {
    isCorrelated: status === "Active",
    status,
    hrUserId: hr.userId || hr.employeeId,
    displayName: hr.displayName || hr.fullName,
    department: hr.department || hr.org,
    checkedAt: now
  };
}

function normalizeStatus(hr) {
  const raw = (hr.status || hr.employmentStatus || "").toLowerCase();
  if (raw.includes("active") || raw.includes("onroll") || raw.includes("enabled")) return "Active";
  return "Inactive";
}

/** Fetch existing entitlements for SoD */
async function getExistingEntitlements(accountsC, userId, appId, scope) {
  let query, params;

  if (scope === "global") {
    query = "SELECT c.entitlement FROM c WHERE c.type='account' AND c.userId=@userId";
    params = [{ name: "@userId", value: userId }];
  } else {
    query = "SELECT c.entitlement FROM c WHERE c.type='account' AND c.userId=@userId AND c.appId=@appId";
    params = [{ name: "@userId", value: userId }, { name: "@appId", value: appId }];
  }

  const { resources } = await accountsC.items.query({ query, parameters: params }).fetchAll();
  return new Set(resources.map(r => r.entitlement));
}

/** Load policies */
async function loadSodPolicies(c, appId) {
  const { resources } = await c.items.query({
    query: "SELECT * FROM c WHERE c.type='sodPolicy' AND c.active=true AND c.appId=@appId",
    parameters: [{ name: "@appId", value: appId }]
  }).fetchAll();
  return resources || [];
}

/** Compute SoD conflicts */
function computeSodConflicts(ent, merged, policies, baseUrl) {
  const out = [];
  for (const policy of policies) {
    const rules = policy.rules || [];
    for (const r of rules) {
      const left = r.left?.trim();
      const right = r.right?.trim();
      if (!left || !right) continue;

      const conflict =
        (ent === left && merged.has(right)) ||
        (ent === right && merged.has(left));

      if (conflict) {
        out.push({
          policyId: policy.policyId || policy.id,
          policyName: policy.name,
          severity: policy.severity || "Medium",
          link: policy.url || (baseUrl ? `${baseUrl}/policies/${encodeURIComponent(policy.policyId || policy.id)}` : null)
        });
      }
    }
  }
  return out;
}

/** Group entitlements by user */
function groupByUserEntitlement(docs) {
  const map = new Map();
  for (const d of docs) {
    if (!map.has(d.userId)) map.set(d.userId, new Set());
    map.get(d.userId).add(d.entitlement);
  }
  return map;
}

/** List existing IDs for the same app (for sync-delete) */
async function listIdsForApp(accountsC, appId) {
  const { resources } = await accountsC.items.query({
    query: "SELECT c.id FROM c WHERE c.type='account' AND c.appId=@appId",
    parameters: [{ name: "@appId", value: appId }]
  }).fetchAll();
  return resources.map(r => r.id);
}