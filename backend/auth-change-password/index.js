const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const crypto = require("crypto");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });

const schema = {
  type: "object",
  required: ["email", "currentPassword", "newPassword"],
  additionalProperties: true,
  properties: {
    email: { type: "string", minLength: 3 },
    currentPassword: { type: "string", minLength: 1 },
    newPassword: { type: "string", minLength: 8 }
  }
};

const validate = ajv.compile(schema);

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  if (!password || !salt || !hash) return false;
  const computed = crypto.pbkdf2Sync(String(password), String(salt), 100000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(String(hash), "hex"));
}

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

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) return bad(400, ajv.errorsText(validate.errors), req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const email = String(body.email || "").trim().toLowerCase();
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");

    if (newPassword === currentPassword) {
      return bad(400, "New password must be different from current password.", req);
    }

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const authC = db.container("userAuth");
    const logsC = db.container("auditLogs");

    const { resources } = await authC.items.query({
      query: "SELECT TOP 1 * FROM c WHERE LOWER(c.email)=@email AND c.type=@type AND c.status='ACTIVE'",
      parameters: [
        { name: "@email", value: email },
        { name: "@type", value: "user-auth" }
      ]
    }).fetchAll();

    const authUser = resources?.[0];
    if (!authUser) return bad(401, "Invalid credentials.", req);

    const validCurrent = verifyPassword(currentPassword, authUser.passwordSalt, authUser.passwordHash);
    if (!validCurrent) return bad(401, "Invalid credentials.", req);

    const hashed = hashPassword(newPassword);
    const nowIso = new Date().toISOString();

    const updated = {
      ...authUser,
      id: authUser.userId,
      userId: authUser.userId,
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      passwordAlgo: "pbkdf2_sha256_100000",
      mustChangePassword: false,
      updatedAt: nowIso,
      type: "user-auth"
    };

    await authC.items.upsert(updated);

    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: authUser.userId,
      userName: email,
      timestamp: nowIso,
      action: "PASSWORD_SELF_RESET",
      details: `Self-service password reset for userId=${authUser.userId}`,
      type: "audit"
    });

    return { status: 200, headers: cors(req), body: { ok: true, message: "Password updated successfully." } };
  } catch (err) {
    context.log.error("auth-change-password error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};
