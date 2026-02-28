const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  try {
    // CORS preflight
    if ((req.method || "").toUpperCase() === "OPTIONS") {
      return { status: 204, headers: cors(req) };
    }

    // Allow GET or POST (like your other APIs)
    const method = (req.method || "").toUpperCase();
    if (!["GET", "POST"].includes(method)) {
      return { status: 405, headers: cors(req), body: { ok: false, error: "MethodNotAllowed" } };
    }

    const COSMOS_CONN = process.env.COSMOS_CONN || process.env.COSMOS_CONNECTION_STRING || "";
    const COSMOS_DB = process.env.COSMOS_DB || "appdb";
    const COSMOS_ACCOUNTS_CONTAINER = process.env.COSMOS_ACCOUNTS_CONTAINER || "accounts";

    if (!COSMOS_CONN) {
      return { status: 500, headers: cors(req), body: { ok: false, error: "COSMOS_CONN not set" } };
    }

    // Parse inputs (query string first, then body for POST)
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const userId = (req.query?.userId || body.userId || "").toString().trim();
    const appId = (req.query?.appId || body.appId || "").toString().trim() || undefined;
    const topParam = Number(req.query?.top ?? body.top ?? 200);
    const top = Number.isFinite(topParam) ? Math.max(1, Math.min(topParam, 1000)) : 200;

    if (!userId) {
      return {
        status: 400,
        headers: cors(req),
        body: { ok: false, error: "Query parameter 'userId' is required" }
      };
    }

    const client = new CosmosClient(COSMOS_CONN);
    const container = client.database(COSMOS_DB).container(COSMOS_ACCOUNTS_CONTAINER);

    // Build query
    // We support: (1) exact userId match, (2) correlation.hrUserId match
    // Always filter to type='account'
    const params = [{ name: "@uid", value: userId }];

    let queryText =
      "SELECT c.id, c.appId, c.userId, c.entitlement, c.name, c.email, c.isOrphan, c.correlation, c.sod, c.createdAt, c.updatedAt " +
      "FROM c WHERE c.type = 'account' AND (c.userId = @uid OR (IS_DEFINED(c.correlation.hrUserId) AND c.correlation.hrUserId = @uid))";

    // Optional appId filter (more efficient; lets us use partition key)
    const queryOptions = { maxItemCount: top };
    if (appId) {
      queryText += " AND c.appId = @appId";
      params.push({ name: "@appId", value: appId });
      // When you supply partitionKey in options, SDK uses single-partition query
      queryOptions.partitionKey = appId;
    }

    const querySpec = { query: queryText, parameters: params };

    // Execute and enforce 'top' cap on results
    const { resources } = await container.items.query(querySpec, queryOptions).fetchAll();
    const items = Array.isArray(resources) ? resources.slice(0, top) : [];

    return {
      status: 200,
      headers: cors(req),
      body: { ok: true, count: items.length, items }
    };
  } catch (err) {
    context.log.error("accounts-get-by-user error:", err?.stack || err);
    return {
      status: 500,
      headers: cors(req),
      body: { ok: false, error: err?.message || "Server error" }
    };
  }
};

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name"
  };
}