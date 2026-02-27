const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });

const ALLOWED_ROLES = new Set(["ADMIN", "AUDITOR", "USER"]);

const schema = {
  type: "object",
  required: ["userId", "role"],
  additionalProperties: true,
  properties: {
    userId: { type: "string", minLength: 1 },
    role: { type: "string", minLength: 1 }
  }
};

const validate = ajv.compile(schema);

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name"
  };
}

function bad(status, error, req) {
  return { status, headers: cors(req), body: { ok: false, error } };
}

async function applyRoleUpdate({ userId, role, db, actorId, actorName }) {
  const authC = db.container("userAuth");
  const hrC = db.container("hrUsers");
  const logsC = db.container("auditLogs");

  let hr = null;
  try {
    const hrRead = await hrC.item(userId, userId).read();
    hr = hrRead?.resource || null;
  } catch (_) {
  }

  let auth = null;
  try {
    const authRead = await authC.item(userId, userId).read();
    auth = authRead?.resource || null;
  } catch (_) {
  }

  const nowIso = new Date().toISOString();

  const authDoc = {
    ...(auth || {}),
    id: userId,
    userId,
    email: String(auth?.email || hr?.email || "").trim().toLowerCase(),
    role,
    status: String(auth?.status || "ACTIVE").toUpperCase(),
    type: "user-auth",
    createdAt: auth?.createdAt || nowIso,
    updatedAt: nowIso
  };

  await authC.items.upsert(authDoc);

  if (hr) {
    const hrDoc = {
      ...hr,
      id: userId,
      userId,
      role,
      updatedAt: nowIso,
      type: hr.type || "hr-user"
    };
    await hrC.items.upsert(hrDoc);
  }

  await logsC.items.upsert({
    id: `LOG_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: actorId,
    userName: actorName,
    timestamp: nowIso,
    action: "ROLE_UPDATE",
    details: `Updated role for userId=${userId} to ${role}`,
    type: "audit"
  });

  return { userId, role };
}

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");

    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";

    if (Array.isArray(body)) {
      if (body.length === 0) return bad(400, "Body array must be non-empty", req);
      const results = [];
      const errors = [];

      for (let i = 0; i < body.length; i++) {
        const item = body[i];
        if (!validate(item)) {
          errors.push({ index: i, error: ajv.errorsText(validate.errors) });
          continue;
        }
        const userId = String(item.userId).trim();
        const role = String(item.role).trim().toUpperCase();
        if (!ALLOWED_ROLES.has(role)) {
          errors.push({ index: i, userId, error: "role must be ADMIN, AUDITOR or USER" });
          continue;
        }
        try {
          const updated = await applyRoleUpdate({ userId, role, db, actorId, actorName });
          results.push(updated);
        } catch (e) {
          errors.push({ index: i, userId, error: e?.message || String(e) });
        }
      }

      return {
        status: errors.length > 0 ? 207 : 200,
        headers: cors(req),
        body: {
          ok: errors.length === 0,
          updatedCount: results.length,
          failedCount: errors.length,
          results,
          errors
        }
      };
    }

    if (!validate(body)) return bad(400, ajv.errorsText(validate.errors), req);

    const userId = String(body.userId).trim();
    const role = String(body.role).trim().toUpperCase();
    if (!ALLOWED_ROLES.has(role)) {
      return bad(400, "role must be ADMIN, AUDITOR or USER", req);
    }

    const updated = await applyRoleUpdate({ userId, role, db, actorId, actorName });

    return { status: 200, headers: cors(req), body: { ok: true, ...updated } };
  } catch (err) {
    context.log.error("auth-set-role error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};
