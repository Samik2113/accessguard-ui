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
      return { status: 405, headers: cors(req), body: { ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "MethodNotAllowed" } } };
    }

    const COSMOS_CONN = process.env.COSMOS_CONN || process.env.COSMOS_CONNECTION_STRING || "";
    const COSMOS_DB = process.env.COSMOS_DB || "appdb";
    const COSMOS_ACCOUNTS_CONTAINER = process.env.COSMOS_ACCOUNTS_CONTAINER || "accounts";

    if (!COSMOS_CONN) {
      return { status: 500, headers: cors(req), body: { ok: false, error: { code: "INTERNAL_ERROR", message: "COSMOS_CONN not set" } } };
    }

    // Parse inputs (query string first, then body for POST)
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const userId = (req.query?.userId || body.userId || "").toString().trim();
    const appId = (req.query?.appId || body.appId || "").toString().trim() || undefined;
    const search = (req.query?.search || body.search || "").toString().trim().toLowerCase();
    const topParam = Number(req.query?.top ?? body.top ?? 200);
    const top = Number.isFinite(topParam) ? Math.max(1, Math.min(topParam, 1000)) : 200;

    if (!userId) {
      return {
        status: 400,
        headers: cors(req),
        body: { ok: false, error: { code: "INVALID_INPUT", message: "Query parameter 'userId' is required" } }
      };
    }

    const client = new CosmosClient(COSMOS_CONN);
    const container = client.database(COSMOS_DB).container(COSMOS_ACCOUNTS_CONTAINER);

    // Build query
    // We support: (1) exact userId match, (2) correlation.hrUserId match
    // Always filter to type='account'
    const params = [{ name: "@uid", value: userId }];

    let queryText =
      "SELECT c.id, c.appId, c.userId, c.userName, c.entitlement, c.name, c.email, c.isOrphan, c.correlation, c.sod, c.isPrivileged, c.createdAt, c.updatedAt, c._etag, c._ts " +
      "FROM c WHERE c.type = 'account' AND (c.userId = @uid OR (IS_DEFINED(c.correlation.hrUserId) AND c.correlation.hrUserId = @uid))";

    if (search) {
      queryText += " AND (CONTAINS(LOWER(c.entitlement), @q) OR CONTAINS(LOWER(c.appId), @q) OR CONTAINS(LOWER(c.userName), @q) OR CONTAINS(LOWER(c.email), @q))";
      params.push({ name: "@q", value: search });
    }

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

    const { etag, lastModified } = listValidators(items);
    if (isNotModified(req, etag, lastModified)) {
      return { status: 304, headers: withValidators(cors(req), etag, lastModified) };
    }

    return {
      status: 200,
      headers: withValidators(cors(req), etag, lastModified),
      body: { ok: true, count: items.length, items }
    };
  } catch (err) {
    context.log.error("accounts-get-by-user error:", err?.stack || err);
    return {
      status: 500,
      headers: cors(req),
      body: { ok: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Server error" } }
    };
  }
};

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-actor-id, x-actor-name, x-functions-key, If-None-Match, If-Modified-Since"
  };
}

function toRfc1123(tsSeconds) {
  const millis = Number(tsSeconds || 0) * 1000;
  return new Date(millis > 0 ? millis : Date.now()).toUTCString();
}

function listValidators(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { etag: 'W/"accounts-by-user-empty"', lastModified: new Date(0).toUTCString() };
  }
  const etags = rows.map((r) => String(r?._etag || "")).filter(Boolean).sort();
  const maxTs = rows.reduce((max, row) => Math.max(max, Number(row?._ts || 0)), 0);
  return {
    etag: `W/\"accounts-by-user-${etags.join("|") || "none"}-${rows.length}-${maxTs}\"`,
    lastModified: toRfc1123(maxTs)
  };
}

function withValidators(headers, etag, lastModified) {
  return {
    ...headers,
    "Cache-Control": "private, max-age=0, must-revalidate",
    "Vary": "x-functions-key, authorization",
    ...(etag ? { ETag: etag } : {}),
    ...(lastModified ? { "Last-Modified": lastModified } : {})
  };
}

function isNotModified(req, etag, lastModified) {
  const ifNoneMatch = req.headers?.["if-none-match"] || req.headers?.["If-None-Match"];
  if (ifNoneMatch && etag && String(ifNoneMatch).trim() === String(etag).trim()) return true;

  const ifModifiedSince = req.headers?.["if-modified-since"] || req.headers?.["If-Modified-Since"];
  if (ifModifiedSince && lastModified) {
    const sinceTs = Date.parse(ifModifiedSince);
    const currentTs = Date.parse(lastModified);
    if (Number.isFinite(sinceTs) && Number.isFinite(currentTs) && currentTs <= sinceTs) return true;
  }
  return false;
}

module.exports.__test = {
  isNotModified,
  listValidators,
  toRfc1123
};