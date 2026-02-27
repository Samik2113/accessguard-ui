const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const crypto = require("crypto");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });

const schema = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: true,
  properties: {
    email: { type: "string", minLength: 3 },
    password: { type: "string", minLength: 1 }
  }
};

const validate = ajv.compile(schema);

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
    const password = String(body.password || "");

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const authC = db.container("userAuth");
    const hrC = db.container("hrUsers");

    const authQuery = await authC.items.query({
      query: "SELECT TOP 1 * FROM c WHERE LOWER(c.email)=@email AND c.type=@type AND c.status='ACTIVE'",
      parameters: [
        { name: "@email", value: email },
        { name: "@type", value: "user-auth" }
      ]
    }).fetchAll();

    const authUser = authQuery.resources?.[0];
    if (!authUser) return bad(401, "Invalid emailId or password.", req);

    const verified = verifyPassword(password, authUser.passwordSalt, authUser.passwordHash);
    if (!verified) return bad(401, "Invalid emailId or password.", req);

    let hrProfile = null;
    try {
      const read = await hrC.item(authUser.userId, authUser.userId).read();
      hrProfile = read?.resource || null;
    } catch (_) {
    }

    const roleRaw = String(authUser.role || "USER").toUpperCase();
    const role = roleRaw === "MANAGER" ? "USER" : roleRaw;

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        user: {
          id: String(authUser.userId),
          userId: String(authUser.userId),
          name: String(hrProfile?.name || authUser.userId),
          email,
          role: role === "ADMIN" || role === "AUDITOR" ? role : "USER"
        },
        mustChangePassword: !!authUser.mustChangePassword
      }
    };
  } catch (err) {
    context.log.error("auth-login error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};
