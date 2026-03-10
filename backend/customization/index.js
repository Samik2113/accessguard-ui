const { CosmosClient } = require("@azure/cosmos");
const Ajv = require("ajv");

const SETTINGS_ID = "APP_CUSTOMIZATION_GLOBAL";
const DEFAULT_IDLE_TIMEOUT_MINUTES = 8 * 60;

const DEFAULT_CUSTOMIZATION = {
  platformName: "AccessGuard",
  primaryColor: "#2563eb",
  environmentLabel: "Development",
  loginSubtitle: "Sign in with emailId and password.",
  supportEmail: "",
  idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES
};

const ajv = new Ajv({ allErrors: true, removeAdditional: "failing" });
const schema = {
  type: "object",
  properties: {
    platformName: { type: "string" },
    primaryColor: { type: "string" },
    environmentLabel: { type: "string" },
    loginSubtitle: { type: "string" },
    supportEmail: { type: "string" },
    idleTimeoutMinutes: { type: "number" }
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
      const customization = await readCustomization(logsC);
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

    const existing = await readCustomization(logsC);
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

async function readCustomization(logsC) {
  try {
    const { resource } = await logsC.item(SETTINGS_ID, SETTINGS_ID).read();
    if (resource?.customization) return normalizeCustomization(resource.customization);
  } catch (_) {
  }

  try {
    const { resources } = await logsC.items.query({
      query: "SELECT TOP 1 c.customization FROM c WHERE c.id=@id OR c.type='app-customization' ORDER BY c._ts DESC",
      parameters: [{ name: "@id", value: SETTINGS_ID }]
    }).fetchAll();
    const hit = resources?.[0]?.customization;
    if (hit) return normalizeCustomization(hit);
  } catch (_) {
  }

  return { ...DEFAULT_CUSTOMIZATION };
}

function normalizeHexColor(input, fallback) {
  const value = String(input || "").trim();
  if (/^#([0-9a-fA-F]{6})$/.test(value)) return value;
  return fallback;
}

function normalizeIdleTimeoutMinutes(input, fallback) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(24 * 60, Math.max(5, Math.round(parsed)));
}

function normalizeCustomization(input) {
  return {
    platformName: String(input?.platformName || DEFAULT_CUSTOMIZATION.platformName),
    primaryColor: normalizeHexColor(input?.primaryColor, DEFAULT_CUSTOMIZATION.primaryColor),
    environmentLabel: String(input?.environmentLabel || DEFAULT_CUSTOMIZATION.environmentLabel),
    loginSubtitle: String(input?.loginSubtitle || DEFAULT_CUSTOMIZATION.loginSubtitle),
    supportEmail: String(input?.supportEmail || DEFAULT_CUSTOMIZATION.supportEmail),
    idleTimeoutMinutes: normalizeIdleTimeoutMinutes(input?.idleTimeoutMinutes, DEFAULT_CUSTOMIZATION.idleTimeoutMinutes)
  };
}

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
