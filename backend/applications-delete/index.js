const { CosmosClient } = require("@azure/cosmos");
const api = require('../dist/services/api');

module.exports = async function (context, req) {
  try {
    // CORS preflight
    if (req.method === "OPTIONS") {
      return { status: 204, headers: cors(req) };
    }

    // Ensure method is DELETE or POST
    if (!["DELETE", "POST"].includes(req.method)) {
      return {
        status: 405,
        headers: cors(req),
        body: { ok: false, error: "MethodNotAllowed" }
      };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      return { status: 500, headers: cors(req), body: { ok: false, error: "COSMOS_CONN not set" } };
    }

    // Parse ID from query OR body
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    let appId =
      req.query?.id ||
      req.query?.appId ||
      body.id ||
      body.appId;

    if (typeof appId === "string") appId = appId.trim();

    // ❗ FIX: If no ID -> return 400 (this will not return 200 anymore)
    if (!appId) {
      return {
        status: 400,
        headers: cors(req),
        body: {
          ok: false,
          error: "BadRequest",
          message: "Missing required parameter 'id' or 'appId'."
        }
      };
    }

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const appsC = db.container("applications");
    const logsC = db.container("auditLogs");
    const now = new Date().toISOString();

    // Try to read the item first
    let existing = null;
    try {
      const { resource } = await appsC.item(appId, appId).read();
      existing = resource;
    } catch (err) {
      if (err.code !== 404) throw err;
    }

    // Not found -> strict 404
    if (!existing) {
      await logDelete(logsC, req, now, "notFound", appId);
      return {
        status: 404,
        headers: cors(req),
        body: {
          ok: false,
          error: "NotFound",
          message: `Application '${appId}' does not exist.`
        }
      };
    }

    // Domain conflict check (optional exactly like you asked)
    if (existing.hasDependencies || existing.locked === true) {
      await logDelete(logsC, req, now, "conflict", appId);
      return {
        status: 409,
        headers: cors(req),
        body: {
          ok: false,
          error: "Conflict",
          message: `Application '${appId}' cannot be deleted due to dependencies.`
        }
      };
    }

    // Delete from Cosmos (id = appId, PK = appId)
    await appsC.item(appId, appId).delete();

    await logDelete(logsC, req, now, "deleted", appId);

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        message: "Application deleted successfully.",
        deletedId: appId
      }
    };

  } catch (err) {
    context.log.error("application-delete error:", err);
    return {
      status: 500,
      headers: cors(req),
      body: { ok: false, error: err.message || "Internal Server Error" }
    };
  }
};

// --- Helpers ---

async function logDelete(logsC, req, now, status, appId) {
  try {
    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";

    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      type: "audit",
      action: "APPLICATION_DELETE",
      timestamp: now,
      userId: actorId,
      userName: actorName,
      details: `${status} id=${appId}`
    });
  } catch {
    // Do not block main operation
  }
}

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "DELETE, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name"
  };
}