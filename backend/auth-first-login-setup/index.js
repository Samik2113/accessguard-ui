const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const crypto = require("crypto");
const { verifyPasswordSetupToken } = require("../_shared/password-setup");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const schema = {
  type: "object",
  required: ["email", "setupToken", "newPassword"],
  additionalProperties: true,
  properties: {
    email: { type: "string", minLength: 3 },
    setupToken: { type: "string", minLength: 8 },
    newPassword: { type: "string", minLength: 8 }
  }
};

const validate = ajv.compile(schema);

function hashPassword(password, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(String(password), salt, 100000, 32, "sha256").toString("hex");
  return { salt, hash };
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
    const setupToken = String(body.setupToken || "").trim();
    const newPassword = String(body.newPassword || "");

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
    if (!authUser) return bad(404, "No active account found for this emailId.", req);
    if (!authUser.mustChangePassword) return bad(400, "This account does not require first-time password setup.", req);
    if (!verifyPasswordSetupToken(authUser, setupToken)) return bad(401, "Invalid or expired password setup token.", req);

    const hashed = hashPassword(newPassword);
    const nowIso = new Date().toISOString();

    await authC.items.upsert({
      ...authUser,
      id: authUser.userId,
      userId: authUser.userId,
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      passwordAlgo: "pbkdf2_sha256_100000",
      mustChangePassword: false,
      setupTokenHash: null,
      setupTokenExpiresAt: null,
      updatedAt: nowIso,
      type: "user-auth"
    });

    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: authUser.userId,
      userName: email,
      timestamp: nowIso,
      action: "PASSWORD_FIRST_LOGIN_SETUP",
      details: `First-time password set for userId=${authUser.userId}`,
      type: "audit"
    });

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        message: "Password created successfully. You can sign in now."
      }
    };
  } catch (err) {
    context.log.error("auth-first-login-setup error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};
