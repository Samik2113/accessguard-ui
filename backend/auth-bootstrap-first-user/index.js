const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const crypto = require("crypto");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const schema = {
  type: "object",
  required: ["email", "name", "password"],
  additionalProperties: true,
  properties: {
    userId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    email: { type: "string", minLength: 3 },
    password: { type: "string", minLength: 8 }
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
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

    const userId = String(body.userId || "ADM001").trim().toUpperCase();
    const email = String(body.email || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const password = String(body.password || "");

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const authC = db.container("userAuth");
    const hrC = db.container("hrUsers");
    const logsC = db.container("auditLogs");

    const existingAuth = await authC.items.query({
      query: "SELECT TOP 1 c.id FROM c WHERE c.type=@type",
      parameters: [{ name: "@type", value: "user-auth" }]
    }).fetchAll();

    if ((existingAuth.resources || []).length > 0) {
      return bad(409, "First user is already provisioned. Use normal login.", req);
    }

    const existingByEmail = await authC.items.query({
      query: "SELECT TOP 1 c.id FROM c WHERE LOWER(c.email)=@email",
      parameters: [{ name: "@email", value: email }]
    }).fetchAll();

    if ((existingByEmail.resources || []).length > 0) {
      return bad(409, "Email already exists.", req);
    }

    const existingByUserId = await authC.items.query({
      query: "SELECT TOP 1 c.id FROM c WHERE c.id=@id",
      parameters: [{ name: "@id", value: userId }]
    }).fetchAll();

    if ((existingByUserId.resources || []).length > 0) {
      return bad(409, "User ID already exists.", req);
    }

    const now = new Date().toISOString();
    const hashed = hashPassword(password);

    await hrC.items.upsert({
      id: userId,
      userId,
      name,
      email,
      status: "ACTIVE",
      role: "ADMIN",
      createdAt: now,
      updatedAt: now,
      type: "hr-user"
    });

    await authC.items.upsert({
      id: userId,
      userId,
      email,
      role: "ADMIN",
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      passwordAlgo: "pbkdf2_sha256_100000",
      mustChangePassword: false,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      type: "user-auth"
    });

    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId,
      userName: name,
      timestamp: now,
      action: "FIRST_USER_BOOTSTRAP",
      details: `First admin user created via UI bootstrap: ${userId}`,
      type: "audit"
    });

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        user: {
          id: userId,
          userId,
          name,
          email,
          role: "ADMIN"
        }
      }
    };
  } catch (err) {
    context.log.error("auth-bootstrap-first-user error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};
