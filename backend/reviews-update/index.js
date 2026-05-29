const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const schema = {
  type: "object",
  required: ["cycleId"],
  properties: {
    cycleId: { type: "string", minLength: 1 },
    dueDate: { type: "string" },
    autoActionOnDueDate: { type: "string", enum: ["REVOKE_ALL", "APPROVE_ALL", "NONE"] }
  },
  additionalProperties: true
};
const validate = ajv.compile(schema);

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) return bad(400, ajv.errorsText(validate.errors), req);

    const actorRole = String(req.headers?.["x-actor-role"] || req.headers?.["X-Actor-Role"] || "").trim().toUpperCase();
    if (actorRole !== "ADMIN") return bad(403, "Only Admin can update campaigns", req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const cyclesC = db.container("reviewCycles");
    const logsC = db.container("auditLogs");
    const now = new Date();

    const cycleId = String(body.cycleId).trim();
    const { resource: cycle } = await cyclesC.item(cycleId, cycleId).read();
    if (!cycle) return bad(404, "Campaign not found", req);

    const status = String(cycle.status || "").toUpperCase();
    if (status === "COMPLETED" || status === "CANCELLED") {
      return bad(409, "Cannot update completed or cancelled campaigns", req);
    }

    // Prepare updates
    const updates = {};
    let changes = [];

    if (body.dueDate !== undefined) {
      const newDueDate = new Date(body.dueDate);
      if (isNaN(newDueDate.getTime())) return bad(400, "Invalid due date format", req);

      const currentDueDate = cycle.dueDate ? new Date(cycle.dueDate) : null;
      if (currentDueDate && newDueDate.getTime() <= currentDueDate.getTime()) {
        return bad(400, "New due date must be after current due date", req);
      }

      updates.dueDate = newDueDate.toISOString();
      changes.push(`dueDate=${updates.dueDate}`);
    }

    if (body.autoActionOnDueDate !== undefined) {
      updates.autoActionOnDueDate = String(body.autoActionOnDueDate).toUpperCase();
      changes.push(`autoActionOnDueDate=${updates.autoActionOnDueDate}`);
    }

    if (Object.keys(updates).length === 0) {
      return bad(400, "No valid updates provided", req);
    }

    // Update the cycle
    updates.updatedAt = now.toISOString();
    await cyclesC.item(cycleId, cycleId).patch({
      operations: Object.entries(updates).map(([path, value]) => ({
        op: "set",
        path: `/${path}`,
        value
      }))
    });

    // Log the update
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: String(req.headers?.["x-actor-id"] || "ADMIN"),
      userName: String(req.headers?.["x-actor-name"] || "Admin User"),
      timestamp: now.toISOString(),
      action: "REVIEW_UPDATE",
      details: `cycleId=${cycleId}; changes=${changes.join("; ")}`,
      type: "audit"
    });

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        cycleId,
        changes
      }
    };
  } catch (error) {
    context.log.error("reviews-update error:", error?.stack || error);
    return bad(500, error?.message || "Internal error", req);
  }
};

function bad(status, message, req, details) {
  return {
    status,
    headers: cors(req),
    body: {
      ok: false,
      error: { message, ...(details ? { details } : {}) }
    }
  };
}

function cors(req) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-functions-key, x-actor-id, x-actor-name, x-actor-role"
  };
}