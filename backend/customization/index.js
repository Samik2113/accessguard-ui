const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");
const {
  SETTINGS_ID,
  DEFAULT_CUSTOMIZATION,
  normalizeCustomization,
  readAppCustomization
} = require("../_shared/customization");

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const schema = {
  type: "object",
  properties: {
    platformName: { type: "string" },
    primaryColor: { type: "string" },
    environmentLabel: { type: "string" },
    loginSubtitle: { type: "string" },
    supportEmail: { type: "string" },
    idleTimeoutMinutes: { type: "number" },
    emailTemplates: {
      type: "object",
      properties: {
        reviewAssignment: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string" }
          },
          additionalProperties: true
        },
        reviewReminder: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string" }
          },
          additionalProperties: true
        },
        reviewEscalation: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string" }
          },
          additionalProperties: true
        },
        remediationNotify: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string" }
          },
          additionalProperties: true
        },
        reviewReassigned: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string" }
          },
          additionalProperties: true
        },
        reviewReassignedBulk: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body: { type: "string" }
          },
          additionalProperties: true
        }
      },
      additionalProperties: true
    }
  },
  additionalProperties: true
};
const validate = ajv.compile(schema);

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "INTERNAL_ERROR", "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const logsC = db.container("auditLogs");

    if (req.method === "GET") {
      const customization = await readAppCustomization(logsC);
      return {
        status: 200,
        headers: cors(req),
        body: { ok: true, customization }
      };
    }

    const actorRole = String(req.headers?.["x-actor-role"] || req.headers?.["X-Actor-Role"] || "").trim().toUpperCase();
    if (actorRole !== "ADMIN") {
      return bad(403, "FORBIDDEN", "Only Admin can update customization", req);
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    if (!validate(body)) {
      return bad(400, "VALIDATION_ERROR", "Invalid payload", req, validate.errors || []);
    }

    const existing = await readAppCustomization(logsC);
    const next = normalizeCustomization({ ...existing, ...body });

    const actorId = String(req.headers?.["x-actor-id"] || "ADM001");
    const actorName = String(req.headers?.["x-actor-name"] || "Admin User");
    const now = new Date().toISOString();

    await logsC.items.upsert({
      id: SETTINGS_ID,
      type: "app-customization",
      customization: next,
      updatedAt: now,
      updatedBy: actorId,
      updatedByName: actorName,
      timestamp: now
    });

    await logsC.items.upsert({
      id: `LOG_${Date.now()}`,
      type: "audit",
      timestamp: now,
      userId: actorId,
      userName: actorName,
      action: "CUSTOMIZATION_UPDATE",
      details: `platformName=${next.platformName}; primaryColor=${next.primaryColor}; environmentLabel=${next.environmentLabel}; idleTimeoutMinutes=${next.idleTimeoutMinutes}`
    });

    return {
      status: 200,
      headers: cors(req),
      body: { ok: true, customization: next }
    };
  } catch (err) {
    context.log.error("customization error:", err?.stack || err);
    return bad(500, "INTERNAL_ERROR", err?.message || "Internal error", req);
  }
};

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name, x-actor-role"
  };
}

function bad(status, code, message, req, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { status, headers: cors(req), body: { ok: false, error } };
}
