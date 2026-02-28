// /reviews-item-action/index.js  (PATCH-based version)
const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true });
const schema = require("../../shared/schemas/reviews/review-item-action.request.schema.json");
const validate = ajv.compile(schema);
const api = require('../dist/services/api');

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) return bad(400, "VALIDATION_ERROR", "Invalid request payload", req, validate.errors || []);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const itemsC = db.container("reviewItems");
    const cyclesC = db.container("reviewCycles");
    const logsC = db.container("auditLogs");
    const hrC = db.container("hrUsers");

    const requestIfMatch = req.headers?.["if-match"] || req.headers?.["If-Match"];
    if (!requestIfMatch || String(requestIfMatch).trim().length === 0) {
      return bad(428, "PRECONDITION_REQUIRED", "If-Match header is required", req);
    }

    const { resource: itm } = await itemsC.item(body.itemId, body.managerId).read();
    if (!itm) return bad(404, "ITEM_NOT_FOUND", "Item not found", req);

    if (String(requestIfMatch).trim() !== String(itm._etag || "").trim()) {
      return bad(412, "ETAG_MISMATCH", "Resource changed", req, {
        expectedEtag: String(requestIfMatch),
        currentEtag: String(itm._etag || "")
      });
    }

    const actorId = req.headers["x-actor-id"] || body.managerId;
    const now = new Date().toISOString();
    const maxReassignments = Math.max(Number(process.env.MAX_REASSIGNMENTS || 3), 1);

    if (body.reassignToManagerId && String(body.reassignToManagerId).trim().length > 0) {
      const targetManagerId = String(body.reassignToManagerId).trim();
      if (targetManagerId === String(body.managerId).trim()) {
        return bad(400, "VALIDATION_ERROR", "Target reviewer must be different from current reviewer.", req);
      }
      if (targetManagerId === String(itm.appUserId || "").trim()) {
        return bad(400, "VALIDATION_ERROR", "Reviewer cannot be the same user whose access is under review.", req);
      }

      const currentReassignmentCount = Number(itm.reassignmentCount || 0);
      if (currentReassignmentCount >= maxReassignments) {
        return bad(400, "VALIDATION_ERROR", `Maximum reassignment limit reached (${maxReassignments}) for this item.`, req);
      }

      let targetHr = null;
      try {
        const hrRead = await hrC.item(targetManagerId, targetManagerId).read();
        targetHr = hrRead?.resource || null;
      } catch (_) {
      }
      if (!targetHr) {
        return bad(400, "VALIDATION_ERROR", `Target reviewer ${targetManagerId} not found in HR users.`, req);
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
      return bad(400, "VALIDATION_ERROR", "status is required for action update", req);
    }

    const newStatus = String(body.status).toUpperCase();

    const isHighRisk = !!itm.isSoDConflict || !!itm.isOrphan;
    if (newStatus === "APPROVED" && isHighRisk && (!body.comment || String(body.comment).trim().length === 0)) {
      return bad(400, "VALIDATION_ERROR", "Justification is required to approve high-risk items.", req, {
        requiredField: "comment",
        reason: "high-risk-approval"
      });
    }

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
      .patch(ops, { accessCondition: { type: "IfMatch", condition: String(requestIfMatch) } });

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
      const pendingItems = pendingItemsFromItems;
      const pendingRemediationItems = pendingRemediationFromItems;

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
    if (err.code === 412) {
      const itemId = req?.body?.itemId;
      const managerId = req?.body?.managerId;
      let currentEtag = null;
      try {
        if (itemId && managerId) {
          const conn = process.env.COSMOS_CONN;
          if (conn) {
            const client = new CosmosClient(conn);
            const { resource } = await client.database("appdb").container("reviewItems").item(itemId, managerId).read();
            currentEtag = resource?._etag || null;
          }
        }
      } catch (_) {
      }
      const requestIfMatch = req.headers?.["if-match"] || req.headers?.["If-Match"];
      return bad(412, "ETAG_MISMATCH", "Resource changed", req, { expectedEtag: String(requestIfMatch || ""), currentEtag });
    }
    context.log.error("reviews/items/action PATCH error:", err?.stack || err);
    return bad(500, "INTERNAL_ERROR", err?.message || "Internal error", req);
  }
};

function cors(req){ return {
  "Access-Control-Allow-Origin": req.headers?.origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, If-Match"
};}
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, code, message, req, details){
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { status, headers: cors(req), body: { ok: false, error } };
}

module.exports.__test = {
  validateRequest: validate
};
