const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const crypto = require("crypto");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });

const schema = {
  type: "object",
  required: ["userId"],
  additionalProperties: true,
  properties: {
    userId: { type: "string", minLength: 1 }
  }
};

const validate = ajv.compile(schema);

function generateTempPassword(length = 12) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

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

function defaultRoleFor(userId) {
  return String(userId || "").trim().toUpperCase() === "ADM001" ? "ADMIN" : "MANAGER";
}

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) return bad(400, ajv.errorsText(validate.errors), req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const targetUserId = String(body.userId).trim();

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const authC = db.container("userAuth");
    const hrC = db.container("hrUsers");
    const logsC = db.container("auditLogs");

    let authUser = null;
    try {
      const read = await authC.item(targetUserId, targetUserId).read();
      authUser = read?.resource || null;
    } catch (_) {
    }

    let hrProfile = null;
    try {
      const hrRead = await hrC.item(targetUserId, targetUserId).read();
      hrProfile = hrRead?.resource || null;
    } catch (_) {
    }

    if (!authUser) {
      if (!hrProfile) {
        return bad(404, `No auth/hr profile found for userId=${targetUserId}. Import HR user first.`, req);
      }
      const hrEmail = String(hrProfile.email || "").trim().toLowerCase();
      if (!hrEmail) {
        return bad(400, `HR profile for userId=${targetUserId} is missing email.`, req);
      }
      authUser = {
        id: targetUserId,
        userId: targetUserId,
        email: hrEmail,
        role: defaultRoleFor(targetUserId),
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        type: "user-auth"
      };
    }

    const temporaryPassword = generateTempPassword();
    const hashed = hashPassword(temporaryPassword);
    const nowIso = new Date().toISOString();

    const updatedAuth = {
      ...authUser,
      id: targetUserId,
      userId: targetUserId,
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      passwordAlgo: "pbkdf2_sha256_100000",
      mustChangePassword: true,
      updatedAt: nowIso,
      type: "user-auth"
    };

    await authC.items.upsert(updatedAuth);

    let displayName = String(hrProfile?.name || targetUserId);
    let email = String(hrProfile?.email || authUser.email || "").trim().toLowerCase();

    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: actorId,
      userName: actorName,
      timestamp: nowIso,
      action: "PASSWORD_RESET",
      details: `Reset temporary password for userId=${targetUserId}`,
      type: "audit"
    });

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        user: {
          userId: targetUserId,
          name: displayName,
          email
        },
        temporaryPassword,
        mustChangePassword: true
      }
    };
  } catch (err) {
    context.log.error("auth-reset-password error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};
