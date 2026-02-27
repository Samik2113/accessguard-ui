const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const crypto = require("crypto");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });

const userSchema = {
  type: "object",
  required: ["userId", "name", "email"],
  additionalProperties: true,
  properties: {
    userId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    email: { type: "string", minLength: 3 },
    managerId: { type: "string" },
    department: { type: "string" },
    title: { type: "string" },
    status: { type: "string" },
    aadOid: { type: "string" }
  }
};
const validateUser = ajv.compile(userSchema);

// simple throttled batch runner
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

function parseBoolean(v) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes" || s === "on";
  }
  if (typeof v === "number") return v === 1;
  return false;
}

function normalizeRole(inputRole, userId) {
  const role = String(inputRole || "").trim().toUpperCase();
  if (role === "ADMIN" || role === "MANAGER" || role === "APP_OWNER") return role;
  if (String(userId || "").trim().toUpperCase() === "ADM001") return "ADMIN";
  return "MANAGER";
}

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

module.exports = async function (context, req) {
  try {
    // Preflight
    if (req.method === "OPTIONS") {
      return { status: 204, headers: corsHeaders(req) };
    }

    const conn = process.env.COSMOS_CONN;
    if (!conn) {
      return { status: 500, headers: corsHeaders(req), body: { ok: false, error: "COSMOS_CONN not set" } };
    }

    // Parse body; support both legacy array and envelope { users: [], replaceAll: true, debug: true }
    const rawBody = typeof req.body === "string" ? JSON.parse(req.body) : (req.body ?? {});
    let users;
    let replaceAll = false;
    let debug = false;
    let resetPasswords = false;
    let returnCredentials = false;

    if (Array.isArray(rawBody)) {
      users = rawBody;
      replaceAll = parseBoolean(req.query?.replaceAll);
      debug = parseBoolean(req.query?.debug);
      resetPasswords = parseBoolean(req.query?.resetPasswords);
      returnCredentials = parseBoolean(req.query?.returnCredentials);
    } else if (rawBody && Array.isArray(rawBody.users)) {
      users = rawBody.users;
      replaceAll = parseBoolean(req.query?.replaceAll) || parseBoolean(rawBody.replaceAll);
      debug = parseBoolean(req.query?.debug) || parseBoolean(rawBody.debug);
      resetPasswords = parseBoolean(req.query?.resetPasswords) || parseBoolean(rawBody.resetPasswords);
      returnCredentials = parseBoolean(req.query?.returnCredentials) || parseBoolean(rawBody.returnCredentials);
    } else {
      return {
        status: 400,
        headers: corsHeaders(req),
        body: { ok: false, error: "Body must be a non-empty array or an object { users: [...] }" }
      };
    }

    if (!Array.isArray(users) || users.length === 0) {
      return { status: 400, headers: corsHeaders(req), body: { ok: false, error: "Users array must be non-empty" } };
    }

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const usersC = db.container("hrUsers");
    const authC = db.container("userAuth");
    const logsC = db.container("auditLogs");

    const now = new Date().toISOString();
    const issuedCredentials = [];

    // upsert function
    const upsertUser = async (u) => {
      if (!validateUser(u)) {
        throw new Error("Schema validation failed: " + ajv.errorsText(validateUser.errors));
      }
      const userId = String(u.userId).trim();
      const email = String(u.email || "").trim().toLowerCase();

      const item = {
        ...u,
        userId,
        email,
        id: userId,            // keep id == userId
        createdAt: u.createdAt || now,
        updatedAt: now,
        type: "hr-user"          // ensure type is set for all docs
      };
      await usersC.items.upsert(item);

      let existingAuth = null;
      try {
        const read = await authC.item(userId, userId).read();
        existingAuth = read?.resource || null;
      } catch (_) {
      }

      const shouldIssueTempPassword = resetPasswords || !existingAuth;
      let tempPassword = null;
      let passwordSalt = existingAuth?.passwordSalt;
      let passwordHash = existingAuth?.passwordHash;

      if (shouldIssueTempPassword) {
        tempPassword = generateTempPassword();
        const hashed = hashPassword(tempPassword);
        passwordSalt = hashed.salt;
        passwordHash = hashed.hash;

        issuedCredentials.push({
          userId,
          name: item.name,
          email,
          temporaryPassword: tempPassword,
          mustChangePassword: true
        });
      }

      const authDoc = {
        id: userId,
        userId,
        email,
        role: normalizeRole(u.role, userId),
        passwordHash,
        passwordSalt,
        passwordAlgo: "pbkdf2_sha256_100000",
        mustChangePassword: shouldIssueTempPassword ? true : !!existingAuth?.mustChangePassword,
        status: "ACTIVE",
        createdAt: existingAuth?.createdAt || now,
        updatedAt: now,
        type: "user-auth"
      };

      if (!authDoc.passwordHash || !authDoc.passwordSalt) {
        throw new Error(`Auth profile missing password hash for userId=${userId}`);
      }

      await authC.items.upsert(authDoc);
      return true;
    };

    // Upsert incoming users in batches
    const { ok, fail, errors } = await runBatches(users, 50, upsertUser);

    // Build incoming id set for replaceAll comparison
    const incomingIds = new Set(users.map(u => u.userId));

    // Decide if we should proceed with delete
    // If you want deletes even when there are upsert failures, change to: const shouldDelete = replaceAll;
    const shouldDelete = replaceAll && fail === 0;

    let deleted = 0;
    let authDeleted = 0;
    let debugInfo;

    if (replaceAll && fail > 0) {
      errors.push({ index: -1, error: "Skipped delete (replaceAll) because there were upsert failures" });
    }

    if (shouldDelete) {
      // Since the container is dedicated to HR users and PK is /userId, we can query exactly what we need.
      // Important: we need userId (PK) for the delete call.
      const existing = await usersC.items.query({
        query: "SELECT c.id, c.userId FROM c WHERE c.type = @type",
        parameters: [{ name: "@type", value: "hr-user" }]
      }).fetchAll();

      const existingDocs = existing.resources || [];

      // anything existing that is not in the current payload must be deleted
      const candidates = existingDocs.filter(doc => !incomingIds.has(doc.id)); // id == userId as per upsert

      // Build deletions (id + partition key userId)
      const deletables = candidates.map(doc => ({ id: doc.id, pk: doc.userId || doc.id }));

      const deleteUser = async ({ id, pk }) => {
        // Container PK is /userId, so pass userId as partition key on delete
        await usersC.item(id, pk).delete();
        return true;
      };

      const delResults = await runBatches(deletables, 50, deleteUser);
      deleted = delResults.ok;

      const deleteAuth = async ({ id, pk }) => {
        await authC.item(id, pk).delete();
        return true;
      };
      const authDelResults = await runBatches(deletables, 50, deleteAuth);
      authDeleted = authDelResults.ok;

      if (debug) {
        debugInfo = {
          pkPath: "/userId",
          totalExisting: existingDocs.length,
          incomingCount: users.length,
          deleteCandidates: candidates.map(d => ({ id: d.id })),
          attemptedDeletes: deletables.map(d => ({ id: d.id, pk: d.pk }))
        };
      }
    }

    // audit log (actor can come from headers or default)
    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: actorId,
      userName: actorName,
      timestamp: now,
      action: "HR_IMPORT",
      details: `Imported ${ok} users; ${fail} failed; ${deleted} hr users deleted; ${authDeleted} auth users deleted; replaceAll=${replaceAll}; resetPasswords=${resetPasswords}`,
      type: "audit"
    });

    return {
      status: fail ? 207 : 200,
      headers: corsHeaders(req),
      body: {
        ok: fail === 0,
        upserted: ok,
        failed: fail,
        deleted,
        authDeleted,
        replaceAll,
        resetPasswords,
        credentialsIssued: issuedCredentials.length,
        skippedDeleteOnFailure: replaceAll && fail > 0,
        errors,
        ...(returnCredentials ? { credentials: issuedCredentials } : {}),
        ...(debugInfo ? { debug: debugInfo } : {})
      }
    };
  } catch (err) {
    context.log.error("hr/import error:", err?.stack || err);
    return { status: 500, headers: corsHeaders(req), body: { ok: false, error: err?.message || "Internal error" } };
  }
};

function corsHeaders(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name"
  };
}