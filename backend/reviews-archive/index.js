const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true });

const schema = {
  type: "object",
  required: ["cycleId", "appId"],
  properties: {
    cycleId: { type: "string", minLength: 1 },
    appId: { type: "string", minLength: 1 }
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
    const cyclesC = db.container("reviewCycles");
    const itemsC = db.container("reviewItems");

    const { resource: cycle } = await cyclesC.item(body.cycleId, body.appId).read();
    if (!cycle) return bad(404, "Cycle not found", req);

    const { resources: cycleItems } = await itemsC.items.query({
      query: "SELECT c.status, c.managerId FROM c WHERE c.reviewCycleId=@cycleId",
      parameters: [{ name: "@cycleId", value: body.cycleId }]
    }).fetchAll();

    const pendingItemsFromItems = cycleItems.filter(i => String(i.status || "").toUpperCase() === "PENDING").length;
    const pendingRemediationFromItems = cycleItems.filter(i => String(i.status || "").toUpperCase() === "REVOKED").length;
    const pendingItems = Math.max(pendingItemsFromItems, Number(cycle.pendingItems || 0));
    const pendingRemediationItems = Math.max(pendingRemediationFromItems, Number(cycle.pendingRemediationItems || 0));

    const managersInCycle = Array.from(new Set(cycleItems.map(i => i.managerId).filter(Boolean)));
    const confirmedManagers = Array.isArray(cycle.confirmedManagers) ? cycle.confirmedManagers : [];
    const allManagersConfirmed = managersInCycle.length > 0 && managersInCycle.every(m => confirmedManagers.includes(m));

    let nextStatus = "ACTIVE";
    const now = new Date().toISOString();

    if (allManagersConfirmed && pendingItems === 0 && pendingRemediationItems > 0) {
      nextStatus = "REMEDIATION";
    } else if (allManagersConfirmed && pendingItems === 0 && pendingRemediationItems === 0) {
      nextStatus = "COMPLETED";
    }

    const patchOps = [
      { op: "set", path: "/status", value: nextStatus },
      { op: "set", path: "/pendingItems", value: pendingItems },
      { op: "set", path: "/pendingRemediationItems", value: pendingRemediationItems }
    ];

    if (nextStatus === "COMPLETED") {
      patchOps.push({ op: "set", path: "/archivedAt", value: now });
      patchOps.push({ op: "set", path: "/completedAt", value: cycle.completedAt || now });
    } else {
      patchOps.push({ op: "set", path: "/archivedAt", value: null });
      patchOps.push({ op: "set", path: "/completedAt", value: null });
    }

    await cyclesC
      .item(body.cycleId, body.appId)
      .patch(
        patchOps,
        { accessCondition: { type: "IfMatch", condition: cycle._etag } }
      );

    return ok({
      cycleId: body.cycleId,
      appId: body.appId,
      status: nextStatus,
      pendingItems,
      pendingRemediationItems,
      archivedAt: nextStatus === "COMPLETED" ? now : null
    }, req);
  } catch (err) {
    if (err.code === 412) {
      return bad(409, "Conflict: the cycle was updated by someone else. Please refresh and retry.", req);
    }
    context.log.error("reviews/archive PATCH error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};

function cors(req) { return {
  "Access-Control-Allow-Origin": req.headers?.origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
}; }

function ok(body, req) { return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, error, req) { return { status, headers: cors(req), body: { ok: false, error } }; }
