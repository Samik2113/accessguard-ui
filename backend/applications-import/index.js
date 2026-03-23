const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });

/**
 * Expected item shape:
 * {
 *   appId: "SAP",
 *   name: "SAP ECC",
 *   appType: "Application",
 *   ownerId: "MGR031",
 *   ownerAdminId: "ADM100",
 *   description: "Finance ERP"
 * }
 */
const appSchema = {
  type: "object",
  required: ["appId", "name"],
  additionalProperties: true,
  properties: {
    appId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    appType: { type: "string", enum: ["Application", "Database", "Servers", "Shared Mailbox"] },
    ownerId: { type: "string" },
    ownerAdminId: { type: "string" },
    description: { type: "string" },
    serverHost: { type: "string" },
    serverHostName: { type: "string" },
    serverEnvironment: { type: "string" },
    accountSchema: { type: "object" }
  }
};
const validateApp = ajv.compile(appSchema);

function normalizeAppType(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "database") return "Database";
  if (raw === "servers" || raw === "server") return "Servers";
  if (raw === "shared mailbox" || raw === "shared_mailbox" || raw === "shared-mailbox") return "Shared Mailbox";
  return "Application";
}

const normalizeKey = (value) => String(value || "").trim().toLowerCase();

async function runBatches(items, batchSize, fn) {
  let ok = 0, fail = 0, errors = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const results = await Promise.allSettled(chunk.map(fn));
    results.forEach((r, idx) => {
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
    if (req.method === "OPTIONS") {
      return { status: 204, headers: cors(req) };
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
    const appsC = db.container("applications"); // PK: /appId
    const logsC = db.container("auditLogs");
    const now = new Date().toISOString();

    const { resources: existingApps } = await appsC.items.query({
      query: "SELECT c.appId, c.name FROM c WHERE c.type='application'"
    }).fetchAll();

    const existingNameToAppId = new Map();
    (existingApps || []).forEach((entry) => {
      const appId = String(entry?.appId || "").trim();
      const nameKey = normalizeKey(entry?.name);
      if (!appId || !nameKey) return;
      existingNameToAppId.set(nameKey, appId);
    });

    const payloadNameToAppId = new Map();
    const payloadAppIdToNameKey = new Map();
    const validationErrors = [];
    payload.forEach((entry, index) => {
      const appId = String(entry?.appId || "").trim();
      const name = String(entry?.name || "").trim();
      const nameKey = normalizeKey(name);

      if (!appId || !nameKey) return;

      const existingAppIdForName = existingNameToAppId.get(nameKey);
      if (existingAppIdForName && existingAppIdForName !== appId) {
        validationErrors.push({
          index,
          appId,
          name,
          error: `Application name '${name}' already exists for appId '${existingAppIdForName}'`
        });
      }

      const payloadAppIdForName = payloadNameToAppId.get(nameKey);
      if (payloadAppIdForName && payloadAppIdForName !== appId) {
        validationErrors.push({
          index,
          appId,
          name,
          error: `Duplicate application name '${name}' in request (also used by appId '${payloadAppIdForName}')`
        });
      }

      const payloadNameForAppId = payloadAppIdToNameKey.get(appId);
      if (payloadNameForAppId && payloadNameForAppId !== nameKey) {
        validationErrors.push({
          index,
          appId,
          name,
          error: `Same appId '${appId}' appears with multiple names in request`
        });
      }

      payloadNameToAppId.set(nameKey, appId);
      payloadAppIdToNameKey.set(appId, nameKey);
    });

    if (validationErrors.length > 0) {
      return {
        status: 409,
        headers: cors(req),
        body: { ok: false, error: "Application name must be unique", errors: validationErrors }
      };
    }

    const upsertApp = async (a) => {
      if (!validateApp(a)) {
        throw new Error("Schema validation failed: " + ajv.errorsText(validateApp.errors));
      }
      const item = {
        id: a.appId,                 // deterministic id
        appId: a.appId,              // PK value
        name: a.name,
        appType: normalizeAppType(a.appType),
        ownerId: a.ownerId || null,
        ownerAdminId: a.ownerAdminId || null,
        description: a.description || "",
        serverHost: a.serverHost || null,
        serverHostName: a.serverHostName || null,
        serverEnvironment: a.serverEnvironment || null,
        accountSchema: a.accountSchema || null,
        createdAt: a.createdAt || now,
        updatedAt: now,
        type: "application"
      };
      await appsC.items.upsert(item);
      return true;
    };

    const { ok, fail, errors } = await runBatches(payload, 50, upsertApp);

    // audit log
    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: actorId,
      userName: actorName,
      timestamp: now,
      action: "APPLICATIONS_IMPORT",
      details: `upserted=${ok}; failed=${fail}`,
      type: "audit"
    });

    return {
      status: fail ? 207 : 200,
      headers: cors(req),
      body: { ok: fail === 0, upserted: ok, failed: fail, errors }
    };
  } catch (err) {
    context.log.error("applications/import error:", err?.stack || err);
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