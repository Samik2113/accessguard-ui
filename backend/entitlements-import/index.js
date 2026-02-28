const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const { customAlphabet } = require("nanoid");
const api = require('../dist/services/api');
const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });

// normalize to a safe token for id components
const safe = (s) => String(s).trim().replace(/\s+/g, "_").replace(/[^\w\-]/g, "").toUpperCase();
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

/**
 * Expected entitlement row:
 * {
 *   entitlement: "FI_VIEW",         // required
 *   description: "Can view FI",
 *   isPrivileged: true|false,
 *   risk: "LOW|MEDIUM|HIGH",
 *   riskScore: 0..n or "0"..,
 *   ownerId: "MGR031"               // <-- optional (new), owner of this entitlement
 * }
 */
const entSchema = {
  type: "object",
  required: ["entitlement"],
  additionalProperties: true,
  properties: {
    entitlement: { type: "string", minLength: 1 },
    description: { type: "string" },
    isPrivileged: { type: "boolean" },
    risk: { type: "string" },
    riskScore: { type: ["string", "number"] },
    ownerId: { type: "string" } // <-- added ownerId (optional)
  }
};
const validateEnt = ajv.compile(entSchema);

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
    // CORS preflight
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const appId = (req.query?.appId || "").trim();
    if (!appId) {
      return { status: 400, headers: cors(req), body: { ok: false, error: "Query param appId is required" } };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      return { status: 500, headers: cors(req), body: { ok: false, error: "COSMOS_CONN not set" } };
    }

    const payload = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || []);
    if (!Array.isArray(payload) || payload.length === 0) {
      return { status: 400, headers: cors(req), body: { ok: false, error: "Body must be a non-empty array" } };
    }

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const entsC = db.container("entitlements");
    const logsC = db.container("auditLogs");
    const now = new Date().toISOString();
    const appIdSafe = safe(appId);

    const upsertEnt = async (e) => {
      if (!validateEnt(e)) {
        throw new Error("Schema validation failed: " + ajv.errorsText(validateEnt.errors));
      }

      const entSafe = safe(e.entitlement);
      // deterministic id per app/entitlement (shorten extremely long names)
      const entIdPart = entSafe.length > 64 ? nanoid() : entSafe;

      // Normalize optional ownerId if provided
      const ownerId =
        typeof e.ownerId === "string"
          ? e.ownerId.trim() || null
          : (e.ownerId == null ? null : String(e.ownerId).trim() || null);

      const item = {
        id: `ENT_${appIdSafe}_${entIdPart}`,
        appId: appId,
        entitlement: entSafe,
        description: e.description || "",
        isPrivileged: !!e.isPrivileged,
        risk: (e.risk || "LOW").toUpperCase(),
        riskScore: String(e.riskScore ?? "0"),
        ownerId, // <-- store ownerId
        createdAt: e.createdAt || now,
        updatedAt: now,
        type: "entitlement"
      };

      await entsC.items.upsert(item);
      return true;
    };

    const { ok, fail, errors } = await runBatches(payload, 50, upsertEnt);

    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: actorId,
      userName: actorName,
      timestamp: now,
      action: "ENTITLEMENTS_IMPORT",
      details: `appId=${appId}; upserted=${ok}; failed=${fail}`,
      type: "audit"
    });

    return {
      status: fail ? 207 : 200,
      headers: cors(req),
      body: { ok: fail === 0, appId, upserted: ok, failed: fail, errors }
    };
  } catch (err) {
    context.log.error("entitlements/import error:", err?.stack || err);
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