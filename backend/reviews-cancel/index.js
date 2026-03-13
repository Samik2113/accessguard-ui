const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");

const ajv = new Ajv({ allErrors: true });
const schema = {
  type: "object",
  required: ["cycleId", "appId"],
  properties: {
    cycleId: { type: "string", minLength: 1 },
    appId: { type: "string", minLength: 1 },
    reason: { type: "string", minLength: 1 }
  },
  additionalProperties: true
};
const validate = ajv.compile(schema);

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) return bad(400, ajv.errorsText(validate.errors), req);
    const cancelReason = String(body.reason || "").trim();
    if (!cancelReason) return bad(400, "Cancel reason is required", req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const cyclesC = db.container("reviewCycles");
    const itemsC = db.container("reviewItems");
    const logsC = db.container("auditLogs");

    const { resource: cycle } = await cyclesC.item(body.cycleId, body.appId).read();
    if (!cycle) return bad(404, "Cycle not found", req);

    if (String(cycle.status || "").toUpperCase() === "CANCELLED") {
      return ok({
        cycleId: body.cycleId,
        appId: body.appId,
        status: "CANCELLED",
        cancelledItems: 0,
        archivedAt: cycle.archivedAt || null
      }, req);
    }

    const now = new Date().toISOString();

    const { resources: cycleItems } = await itemsC.items.query({
      query: "SELECT c.id, c.managerId, c.status, c._etag FROM c WHERE c.reviewCycleId=@cycleId",
      parameters: [{ name: "@cycleId", value: body.cycleId }]
    }).fetchAll();

    const cancellable = (cycleItems || []).filter((item) => String(item?.status || "").toUpperCase() !== "CANCELLED");

    const BATCH = 50;
    for (let i = 0; i < cancellable.length; i += BATCH) {
      const chunk = cancellable.slice(i, i + BATCH);
      await Promise.all(chunk.map(async (item) => {
        await itemsC.item(item.id, item.managerId).patch(
          [
            { op: "set", path: "/status", value: "CANCELLED" },
            { op: "set", path: "/cancelledAt", value: now },
            { op: "set", path: "/cancelReason", value: cancelReason }
          ],
          { accessCondition: { type: "IfMatch", condition: item._etag } }
        );
      }));
    }

    await cyclesC.item(body.cycleId, body.appId).patch(
      [
        { op: "set", path: "/status", value: "CANCELLED" },
        { op: "set", path: "/pendingItems", value: 0 },
        { op: "set", path: "/pendingRemediationItems", value: 0 },
        { op: "set", path: "/archivedAt", value: now },
        { op: "set", path: "/cancelledAt", value: now },
        { op: "set", path: "/cancelReason", value: cancelReason }
      ],
      { accessCondition: { type: "IfMatch", condition: cycle._etag } }
    );

    const actorId = req.headers["x-actor-id"] || "ADM001";
    const actorName = req.headers["x-actor-name"] || "Admin User";
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: actorId,
      userName: actorName,
      timestamp: now,
      action: "REVIEW_CANCEL",
      details: `cycleId=${body.cycleId}; appId=${body.appId}; itemsCancelled=${cancellable.length}; reason=${cancelReason}`,
      type: "audit"
    });

    return ok({
      cycleId: body.cycleId,
      appId: body.appId,
      status: "CANCELLED",
      cancelledItems: cancellable.length,
      archivedAt: now
    }, req);
  } catch (err) {
    if (err.code === 412) {
      return bad(409, "Conflict: cycle/items updated by someone else. Please refresh and retry.", req);
    }
    context.log.error("reviews/cancel error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name"
  };
}

function ok(body, req) {
  return { status: 200, headers: cors(req), body: { ok: true, ...body } };
}

function bad(status, error, req) {
  return { status, headers: cors(req), body: { ok: false, error } };
}
