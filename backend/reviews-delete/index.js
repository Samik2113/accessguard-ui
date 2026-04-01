const { CosmosClient } = require("@azure/cosmos");
const { readCycleById } = require("../_shared/review-campaigns");

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const cycleId = String(body.cycleId || "").trim();
    if (!cycleId) return bad(400, "cycleId is required", req);

    const actorRole = String(req.headers?.["x-actor-role"] || req.headers?.["X-Actor-Role"] || "").trim().toUpperCase();
    if (actorRole !== "ADMIN") return bad(403, "Only Admin can delete draft campaigns", req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const cyclesC = db.container("reviewCycles");
    const itemsC = db.container("reviewItems");
    const logsC = db.container("auditLogs");
    const cycle = await readCycleById(cyclesC, cycleId);
    if (!cycle) return bad(404, "Review cycle not found", req);
    if (String(cycle.status || "").toUpperCase() !== "DRAFT") return bad(409, "Only draft campaigns can be deleted", req);

    const { resources: previewItems } = await itemsC.items.query({
      query: "SELECT c.id, c.managerId FROM c WHERE c.reviewCycleId=@cycleId AND c.type=@type",
      parameters: [
        { name: "@cycleId", value: cycleId },
        { name: "@type", value: "review-item-preview" }
      ]
    }).fetchAll();

    await Promise.all((previewItems || []).map((item) => itemsC.item(item.id, item.managerId).delete().catch(() => null)));
    await cyclesC.item(cycle.id, cycle.appId).delete();
    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: String(req.headers?.["x-actor-id"] || "ADMIN"),
      userName: String(req.headers?.["x-actor-name"] || "Admin User"),
      timestamp: new Date().toISOString(),
      action: "REVIEW_DRAFT_DELETE",
      details: `cycleId=${cycleId}; name=${cycle.name}`,
      type: "audit"
    });

    return { status: 200, headers: cors(req), body: { ok: true, cycleId } };
  } catch (error) {
    context.log.error("reviews-delete error:", error?.stack || error);
    return bad(500, error?.message || "Internal error", req);
  }
};

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name, x-actor-role"
  };
}

function bad(status, error, req) {
  return { status, headers: cors(req), body: { ok: false, error } };
}