// /reviews-item-action/index.js  (PATCH-based version)
const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true });

const schema = {
  type: "object",
  required: ["itemId", "managerId", "status"],
  properties: {
    itemId: { type: "string", minLength: 1 },
    managerId: { type: "string", minLength: 1 },
    status: { type: "string", minLength: 1 },
    comment: { type: "string" },
    remediationComment: { type: "string" },
    remediatedAt: { type: "string" }
  },
  additionalProperties: true
};
const validate = ajv.compile(schema);

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) return bad(400, ajv.errorsText(validate.errors), req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const itemsC = db.container("reviewItems");
    const cyclesC = db.container("reviewCycles");
    const logsC = db.container("auditLogs");

    const { resource: itm } = await itemsC.item(body.itemId, body.managerId).read();
    if (!itm) return bad(404, "Item not found", req);

    const oldWasPending = String(itm.status).toUpperCase() === "PENDING";
    const newStatus = String(body.status).toUpperCase();
    const now = new Date().toISOString();

    const ops = [
      { op: "set", path: "/status", value: newStatus }
    ];

    // Keep review decision metadata separate from remediation metadata.
    if (newStatus === "REMEDIATED") {
      const remediationTs = (typeof body.remediatedAt === "string" && body.remediatedAt.trim().length > 0)
        ? body.remediatedAt
        : now;
      ops.push({ op: "set", path: "/remediatedAt", value: remediationTs });
      if (typeof body.remediationComment === "string") {
        ops.push({ op: "set", path: "/remediationComment", value: body.remediationComment });
      }
    } else {
      ops.push({ op: "set", path: "/actionedAt", value: now });
      if (typeof body.comment === "string") {
        ops.push({ op: "set", path: "/comment", value: body.comment });
      }
    }

    await itemsC
      .item(body.itemId, body.managerId)
      .patch(ops, { accessCondition: { type: "IfMatch", condition: itm._etag } });

    // Only maintain pending counter here; cycle stage transitions happen on manager finalize flow.
    if (oldWasPending && newStatus !== "PENDING") {
      const cycleId = itm.reviewCycleId;
      const appId = itm.appId;

      const { resource: cyc } = await cyclesC.item(cycleId, appId).read();
      if (cyc) {
        await cyclesC
          .item(cycleId, appId)
          .patch(
            [{ op: "incr", path: "/pendingItems", value: -1 }],
            { accessCondition: { type: "IfMatch", condition: cyc._etag } }
          );
      }
    }

    const actorId = req.headers["x-actor-id"] || body.managerId;
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: actorId,
      userName: null,
      timestamp: now,
      action: "REVIEW_ITEM_ACTION",
      details: `itemId=${body.itemId}; status=${newStatus}`,
      type: "audit"
    });

    return ok({ itemId: body.itemId, status: newStatus }, req);
  } catch (err) {
    if (err.code === 412) return bad(409, "Conflict: the item or cycle was updated by someone else. Refresh and retry.", req);
    context.log.error("reviews/items/action PATCH error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};

function cors(req){ return {
  "Access-Control-Allow-Origin": req.headers?.origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id"
};}
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, error, req){ return { status, headers: cors(req), body: { ok: false, error } }; }
