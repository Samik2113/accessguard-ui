const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const { buildCampaignDefinition, persistCampaignDefinition, findOverlappingDraftOrActiveCycles, readCycleById } = require("../_shared/review-campaigns");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const schema = {
  type: "object",
  required: ["name", "ownerId", "scope", "reviewerType"],
  properties: {
    cycleId: { type: "string" },
    name: { type: "string", minLength: 1 },
    ownerId: { type: "string", minLength: 1 },
    dueDate: { type: "string" },
    startAt: { type: "string" },
    startNow: { type: "boolean" },
    riskScope: { type: "string" },
    reviewerType: { type: "string" },
    specificReviewerId: { type: "string" },
    scope: { type: "object" }
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
    if (actorRole !== "ADMIN") return bad(403, "Only Admin can stage certification campaigns", req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const cyclesC = db.container("reviewCycles");
    const logsC = db.container("auditLogs");
    const now = new Date();

    const existingCycle = body.cycleId ? await readCycleById(cyclesC, String(body.cycleId).trim()) : null;
    if (existingCycle && String(existingCycle.status || "").toUpperCase() !== "DRAFT") {
      return bad(409, "Only draft campaigns can be edited", req);
    }

    const definition = await buildCampaignDefinition({
      db,
      payload: body,
      actor: {
        id: String(req.headers?.["x-actor-id"] || "ADMIN"),
        name: String(req.headers?.["x-actor-name"] || "Admin User")
      },
      now,
      mode: "DRAFT",
      cycleId: existingCycle?.id || String(body.cycleId || "").trim() || undefined
    });

    const overlaps = await findOverlappingDraftOrActiveCycles(cyclesC, definition.summary.selectedAppIds, definition.cycle.id);
    if (overlaps.length > 0) {
      return bad(409, `Selected scope overlaps with existing campaign(s): ${overlaps.map((cycle) => cycle.name).join(", ")}`, req);
    }

    const staged = await persistCampaignDefinition({ db, definition, mode: "DRAFT", existingCycle });

    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      userId: String(req.headers?.["x-actor-id"] || "ADMIN"),
      userName: String(req.headers?.["x-actor-name"] || "Admin User"),
      timestamp: now.toISOString(),
      action: existingCycle ? "REVIEW_STAGE_UPDATE" : "REVIEW_STAGE_CREATE",
      details: `cycleId=${staged.cycle.id}; scope=${staged.summary.scopeSummary}; reviewer=${staged.summary.reviewerLabel}; items=${staged.items.length}`,
      type: "audit"
    });

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        cycleId: staged.cycle.id,
        cycle: staged.cycle,
        status: "DRAFT",
        itemsPrepared: staged.items.length,
        scopeSummary: staged.summary.scopeSummary,
        reviewerLabel: staged.summary.reviewerLabel
      }
    };
  } catch (error) {
    context.log.error("reviews-stage error:", error?.stack || error);
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