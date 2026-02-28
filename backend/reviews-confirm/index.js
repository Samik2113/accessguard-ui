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
    if (!validate(body)) return bad(400, ajv.errorsText(validate.errors), req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const cyclesC = db.container("reviewCycles"); // PK: /appId
    const itemsC  = db.container("reviewItems");  // PK: /managerId
    const logsC   = db.container("auditLogs");

    // 1) Read cycle (need _etag + current confirmedManagers)
    const { resource: cyc } = await cyclesC.item(body.cycleId, body.appId).read();
    if (!cyc) return bad(404, "Cycle not found", req);

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

    // Everyone confirmed? We need the set of managers in the cycle
    const { resources: mgrRows } = await itemsC.items
      .query({ query: "SELECT DISTINCT c.managerId FROM c WHERE c.reviewCycleId=@id", parameters: [{ name: "@id", value: body.cycleId }] })
      .fetchAll();
    const allManagers = mgrRows.map(x => x.managerId).filter(Boolean);

    const everyoneConfirmed = allManagers.length > 0 && allManagers.every(m => union.includes(m));
    const pending = cyc.pendingItems ?? 0;

    // Decide status advance
    if (everyoneConfirmed && pending === 0) {
      const now = new Date().toISOString();
      await cyclesC
        .item(body.cycleId, body.appId)
        .patch(
          [
            { op: "set", path: "/status",      value: "COMPLETED" },
            { op: "set", path: "/completedAt", value: now }
          ],
          { accessCondition: { type: "IfMatch", condition: etag } }
        );
    } else if (pending === 0 && String(cyc.status).toUpperCase() === "ACTIVE") {
      await cyclesC
        .item(body.cycleId, body.appId)
        .patch(
          [{ op: "set", path: "/status", value: "PENDING_VERIFICATION" }],
          { accessCondition: { type: "IfMatch", condition: etag } }
        );
    }

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
    if (err.code === 412) return bad(409, "Conflict: the cycle was updated by someone else. Refresh and retry.", req);
    context.log.error("reviews/confirm PATCH error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};

function cors(req){ return {
  "Access-Control-Allow-Origin": req.headers?.origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};}
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, error, req){ return { status, headers: cors(req), body: { ok: false, error } }; }