// /reviews-confirm/index.js  (PATCH-based)
const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const ajv = new Ajv({ allErrors: true });
const schema = {
  type: "object",
  required: ["cycleId", "appId", "managerId"],
  properties: {
    cycleId: { type: "string", minLength: 1 },
    appId:   { type: "string", minLength: 1 },
    managerId: { type: "string", minLength: 1 }
  },
  additionalProperties: true
};
const validate = ajv.compile(schema);

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) return bad(400, "VALIDATION_ERROR", "Invalid request payload", req, validate.errors || []);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "INTERNAL_ERROR", "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const cyclesC = db.container("reviewCycles"); // PK: /appId
    const itemsC  = db.container("reviewItems");  // PK: /managerId
    const logsC   = db.container("auditLogs");

    // 1) Read cycle (need _etag + current confirmedManagers)
    const { resource: cyc } = await cyclesC.item(body.cycleId, body.appId).read();
    if (!cyc) return bad(404, "CYCLE_NOT_FOUND", "Cycle not found", req);

    const current = Array.isArray(cyc.confirmedManagers) ? cyc.confirmedManagers : [];
    const union = Array.from(new Set([...current, body.managerId]));

    // If nothing changed, we still check advancement conditions; else patch the array first
    let etag = cyc._etag;

    if (union.length !== current.length) {
      const patchResp = await cyclesC
        .item(body.cycleId, body.appId)
        .patch(
          [{ op: "set", path: "/confirmedManagers", value: union }],
          { accessCondition: { type: "IfMatch", condition: etag } }
        );
      etag = patchResp.resource?._etag || etag;
    }

    const { resources: cycleItems } = await itemsC.items
      .query({
        query: "SELECT c.status, c.managerId FROM c WHERE c.reviewCycleId=@id",
        parameters: [{ name: "@id", value: body.cycleId }]
      })
      .fetchAll();

    const allManagers = Array.from(new Set((cycleItems || []).map((item) => item.managerId).filter(Boolean)));
    const everyoneConfirmed = allManagers.length > 0 && allManagers.every((managerId) => union.includes(managerId));

    const pendingItems = (cycleItems || []).filter((item) => String(item.status || "").toUpperCase() === "PENDING").length;
    const pendingRemediationItems = (cycleItems || []).filter((item) => String(item.status || "").toUpperCase() === "REVOKED").length;

    let nextStatus = "ACTIVE";
    if (everyoneConfirmed && pendingItems === 0 && pendingRemediationItems === 0) {
      nextStatus = "COMPLETED";
    } else if (everyoneConfirmed && pendingItems === 0 && pendingRemediationItems > 0) {
      nextStatus = "REMEDIATION";
    } else if (pendingItems === 0) {
      nextStatus = "PENDING_VERIFICATION";
    }

    const now = new Date().toISOString();
    const cycleOps = [
      { op: "set", path: "/pendingItems", value: pendingItems },
      { op: "set", path: "/pendingRemediationItems", value: pendingRemediationItems },
      { op: "set", path: "/status", value: nextStatus }
    ];
    cycleOps.push({ op: "set", path: "/completedAt", value: nextStatus === "COMPLETED" ? (cyc.completedAt || now) : null });

    await cyclesC
      .item(body.cycleId, body.appId)
      .patch(cycleOps, { accessCondition: { type: "IfMatch", condition: etag } });

    // Audit
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: body.managerId,
      userName: null,
      timestamp: new Date().toISOString(),
      action: "REVIEW_MANAGER_CONFIRM",
      details: `cycleId=${body.cycleId}; confirmedManager=${body.managerId}`,
      type: "audit"
    });

    return ok({ cycleId: body.cycleId, appId: body.appId, confirmedManagers: union }, req);
  } catch (err) {
    if (err.code === 412) return bad(412, "ETAG_MISMATCH", "Resource changed", req);
    context.log.error("reviews/confirm PATCH error:", err?.stack || err);
    return bad(500, "INTERNAL_ERROR", err?.message || "Internal error", req);
  }
};

function cors(req){ return {
  "Access-Control-Allow-Origin": req.headers?.origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};}
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, code, message, req, details){
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { status, headers: cors(req), body: { ok: false, error } };
}