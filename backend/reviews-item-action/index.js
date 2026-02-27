// /reviews-item-action/index.js  (PATCH-based version)
const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true });

const schema = {
  type: "object",
  required: ["itemId", "managerId"],
  properties: {
    itemId: { type: "string", minLength: 1 },
    managerId: { type: "string", minLength: 1 },
    status: { type: "string", minLength: 1 },
    reassignToManagerId: { type: "string" },
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
    const hrC = db.container("hrUsers");

    const { resource: itm } = await itemsC.item(body.itemId, body.managerId).read();
    if (!itm) return bad(404, "Item not found", req);

    const actorId = req.headers["x-actor-id"] || body.managerId;
    const now = new Date().toISOString();
    const maxReassignments = Math.max(Number(process.env.MAX_REASSIGNMENTS || 3), 1);

    if (body.reassignToManagerId && String(body.reassignToManagerId).trim().length > 0) {
      const targetManagerId = String(body.reassignToManagerId).trim();
      if (targetManagerId === String(body.managerId).trim()) {
        return bad(400, "Target reviewer must be different from current reviewer.", req);
      }
      if (targetManagerId === String(itm.appUserId || "").trim()) {
        return bad(400, "Reviewer cannot be the same user whose access is under review.", req);
      }

      const currentReassignmentCount = Number(itm.reassignmentCount || 0);
      if (currentReassignmentCount >= maxReassignments) {
        return bad(400, `Maximum reassignment limit reached (${maxReassignments}) for this item.`, req);
      }

      let targetHr = null;
      try {
        const hrRead = await hrC.item(targetManagerId, targetManagerId).read();
        targetHr = hrRead?.resource || null;
      } catch (_) {
      }
      if (!targetHr) {
        return bad(400, `Target reviewer ${targetManagerId} not found in HR users.`, req);
      }

      const reassignedItem = {
        ...itm,
        id: itm.id,
        managerId: targetManagerId,
        reassignedAt: now,
        reassignedBy: actorId,
        reassignmentCount: currentReassignmentCount + 1,
        reassignmentComment: typeof body.comment === "string" ? body.comment : (itm.reassignmentComment || null),
        updatedAt: now
      };

      await itemsC.items.upsert(reassignedItem);
      await itemsC.item(body.itemId, body.managerId).delete();

      await logsC.items.upsert({
        id: `LOG_${Date.now()}`,
        userId: actorId,
        userName: null,
        timestamp: now,
        action: "REVIEW_ITEM_REASSIGN",
        details: `itemId=${body.itemId}; from=${body.managerId}; to=${targetManagerId}`,
        type: "audit"
      });

      return ok({ itemId: body.itemId, managerId: targetManagerId, reassigned: true, reassignmentCount: currentReassignmentCount + 1, maxReassignments }, req);
    }

    if (!body.status || String(body.status).trim().length === 0) {
      return bad(400, "status is required for action update", req);
    }

    const newStatus = String(body.status).toUpperCase();

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

    // Recompute cycle counters after action so backend remains source-of-truth.
    const cycleId = itm.reviewCycleId;
    const appId = itm.appId;
    const { resource: cyc } = await cyclesC.item(cycleId, appId).read();
    if (cyc) {
      const { resources: cycleItems } = await itemsC.items.query({
        query: "SELECT c.status, c.managerId FROM c WHERE c.reviewCycleId=@cycleId",
        parameters: [{ name: "@cycleId", value: cycleId }]
      }).fetchAll();

      const pendingItemsFromItems = cycleItems.filter(i => String(i.status || "").toUpperCase() === "PENDING").length;
      const pendingRemediationFromItems = cycleItems.filter(i => String(i.status || "").toUpperCase() === "REVOKED").length;
      const pendingItems = Math.max(pendingItemsFromItems, Number(cyc.pendingItems || 0));
      const pendingRemediationItems = Math.max(pendingRemediationFromItems, Number(cyc.pendingRemediationItems || 0));

      const managersInCycle = Array.from(new Set(cycleItems.map(i => i.managerId).filter(Boolean)));
      const confirmedManagers = Array.isArray(cyc.confirmedManagers) ? cyc.confirmedManagers : [];
      const allManagersConfirmed = managersInCycle.length > 0 && managersInCycle.every(m => confirmedManagers.includes(m));

      let nextStatus = "ACTIVE";
      if (allManagersConfirmed && pendingItems === 0 && pendingRemediationItems > 0) {
        nextStatus = "REMEDIATION";
      } else if (allManagersConfirmed && pendingItems === 0 && pendingRemediationItems === 0) {
        nextStatus = "COMPLETED";
      }

      const cycleOps = [
        { op: "set", path: "/pendingItems", value: pendingItems },
        { op: "set", path: "/pendingRemediationItems", value: pendingRemediationItems },
        { op: "set", path: "/status", value: nextStatus }
      ];

      if (nextStatus === "COMPLETED") {
        cycleOps.push({ op: "set", path: "/completedAt", value: cyc.completedAt || now });
      }

      await cyclesC
        .item(cycleId, appId)
        .patch(
          cycleOps,
          { accessCondition: { type: "IfMatch", condition: cyc._etag } }
        );
    }

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
