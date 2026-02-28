
const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const { customAlphabet } = require("nanoid");
const api = require('../dist/services/api');
const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const safe = (s) => String(s || "").trim().replace(/\s+/g, "_").replace(/[^\w\-]/g, "").toUpperCase();
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

const sodSchema = {
  type: "object",
  required: ["appId1", "entitlement1", "appId2", "entitlement2"],
  additionalProperties: true,
  properties: {
    policyId: { type: "string" },
    id: { type: "string" },
    policyName: { type: "string" },
    appId1: { type: "string", minLength: 1 },
    entitlement1: { type: "string", minLength: 1 },
    appId2: { type: "string", minLength: 1 },
    entitlement2: { type: "string", minLength: 1 },

    // you can send additional properties like riskLevel, active, url, etc.
    riskLevel: { type: "string" },
    active: { type: "boolean" },
    url: { type: "string" }
  }
};
const validateSod = ajv.compile(sodSchema);

async function runBatches(items, sz, fn) {
  let ok = 0, fail = 0, errors = [];
  for (let i = 0; i < items.length; i += sz) {
    const chunk = items.slice(i, i + sz);
    const res = await Promise.allSettled(chunk.map(fn));
    res.forEach((r, idx) => {
      if (r.status === "fulfilled") ok++;
      else {
        fail++;
        errors.push({ index: i + idx, error: r.reason?.message || String(r.reason) });
      }
    });
  }
  return { ok, fail, errors };
}

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") {
      return { status: 204, headers: cors(req) };
    }

    if ((req.method || "").toUpperCase() !== "POST") {
      return { status: 405, headers: cors(req), body: { ok: false, error: "MethodNotAllowed" } };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      return { status: 500, headers: cors(req), body: { ok: false, error: "COSMOS_CONN not set" } };
    }

    const raw = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || []);
    if (!Array.isArray(raw) || raw.length === 0) {
      return { status: 400, headers: cors(req), body: { ok: false, error: "Body must be a non-empty array" } };
    }

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const sodC = db.container("sodPolicies");
    const logsC = db.container("auditLogs");
    const now = new Date().toISOString();

    // --- helpers ---

    // Always parameterize correctly
    const findByPolicyName = async (policyName) => {
      if (!policyName) return null;
      const { resources } = await sodC.items
        .query({
          query: "SELECT c.id FROM c WHERE LOWER(c.policyName) = @name",
          parameters: [{ name: "@name", value: policyName.toLowerCase() }]
        })
        .fetchAll();
      return resources && resources.length > 0 ? resources[0] : null;
    };

    // Try multiple ways to determine id; return a string id to upsert under
    const resolveIdForCreateOrUpdate = async (p) => {
      const incoming = (p.id || p.policyId || "").toString().trim();
      const policyNameRaw = (p.policyName || "").toString().trim();
      const policyName = policyNameRaw || `${p.entitlement1 || ""} vs ${p.entitlement2 || ""}`.trim();

      // 1) if id provided, check if it exists (use id as partitionKey for /id or /policyId)
      if (incoming) {
        try {
          const read = await sodC.item(incoming, incoming).read();
          if (read?.resource) return read.resource.id;
        } catch (e) {
          // ignore not found; continue
        }
      }

      // 2) find by name
      if (policyName) {
        const found = await findByPolicyName(policyName);
        if (found?.id) return found.id;
      }

      // 3) deterministic id fallback (idempotent)
      if (p.appId1 && p.entitlement1 && p.appId2 && p.entitlement2) {
        return `SOD_${safe(policyName) || `${safe(p.appId1)}_${safe(p.entitlement1)}__${safe(p.appId2)}_${safe(p.entitlement2)}`}`;
      }
      // fallback random if even essential fields missing (shouldn't happen due to validation)
      return `SOD_${nanoid()}`;
    };

    const upsertPolicy = async (p) => {
      if (!validateSod(p)) {
        throw new Error("Schema validation failed: " + ajv.errorsText(validateSod.errors || []));
      }

      const policyNameRaw = (p.policyName || "").toString().trim();
      const policyName = policyNameRaw || `${p.entitlement1 || ""} vs ${p.entitlement2 || ""}`.trim();
      const id = await resolveIdForCreateOrUpdate(p);

      const item = {
        id,
        policyId: id, // helps if PK is /policyId
        policyName: policyName || `${safe(p.entitlement1)} vs ${safe(p.entitlement2)}`,
        appId1: safe(p.appId1),
        entitlement1: safe(p.entitlement1),
        appId2: safe(p.appId2),
        entitlement2: safe(p.entitlement2),
        riskLevel: (p.riskLevel || "MEDIUM").toUpperCase(),
        url: p.url || null,
        active: typeof p.active === "boolean" ? p.active : true,
        createdAt: p.createdAt || now,
        updatedAt: now,
        type: "sodPolicy" // align with the rest of your system
      };

      // Upsert (SDK infers partition key from body)
      await sodC.items.upsert(item);
      return true;
    };

    const deletePolicy = async (p) => {
      const actionMarker = (p.action || p._action || "").toString().toUpperCase();
      const isDelete = actionMarker === "DELETE" || actionMarker === "REMOVE" || p.delete === true || p._delete === true;
      if (!isDelete) throw new Error("Not a delete action");

      // Prefer explicit id/policyId
      const incoming = (p.id || p.policyId || "").toString().trim();
      if (incoming) {
        try {
          await sodC.item(incoming, incoming).delete(); // pass partition key
          return true;
        } catch (err) {
          // ignore; try name next
        }
      }

      // Try by policyName
      const policyNameRaw = (p.policyName || "").toString().trim();
      if (policyNameRaw) {
        const found = await findByPolicyName(policyNameRaw);
        if (found?.id) {
          await sodC.item(found.id, found.id).delete(); // pass pk
          return true;
        }
      }

      // Derive deterministic id
      const candidateId = `SOD_${safe(p.policyName || `${p.appId1 || ""}_${p.entitlement1 || ""}__${p.appId2 || ""}_${p.entitlement2 || ""}`)}`;
      try {
        await sodC.item(candidateId, candidateId).delete(); // pass pk
        return true;
      } catch (err) {
        throw new Error("Policy not found for deletion");
      }
    };

    // Partition payload into upserts and deletes
    const toUpsert = [];
    const toDelete = [];
    for (const it of raw) {
      const marker = (it.action || it._action || "").toString().toUpperCase();
      const isDelete = marker === "DELETE" || marker === "REMOVE" || it.delete === true || it._delete === true;
      if (isDelete) toDelete.push(it);
      else toUpsert.push(it);
    }

    // Execute in batches
    let upsertResult = { ok: 0, fail: 0, errors: [] };
    let deleteResult = { ok: 0, fail: 0, errors: [] };

    if (toUpsert.length > 0) upsertResult = await runBatches(toUpsert, 50, upsertPolicy);
    if (toDelete.length > 0) deleteResult = await runBatches(toDelete, 50, deletePolicy);

    const totalUpserted = upsertResult.ok;
    const totalDeleted = deleteResult.ok;
    const totalFailed = (upsertResult.fail || 0) + (deleteResult.fail || 0);
    const combinedErrors = [...(upsertResult.errors || []), ...(deleteResult.errors || [])];

    // Audit
    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: actorId,
      userName: actorName,
      timestamp: now,
      action: "SOD_IMPORT",
      details: `upserted=${totalUpserted}; deleted=${totalDeleted}; failed=${totalFailed}`,
      type: "audit"
    });

    return {
      status: totalFailed ? 207 : 200,
      headers: cors(req),
      body: { ok: totalFailed === 0, upserted: totalUpserted, deleted: totalDeleted, failed: totalFailed, errors: combinedErrors }
    };
  } catch (err) {
    context.log.error("sod/import error:", err?.stack || err);
    return { status: 500, headers: cors(req), body: { ok: false, error: err?.message || "Internal error" } };
  }
};

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name"
  };
}