const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };
    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "INTERNAL_ERROR", "COSMOS_CONN not set", req);

    const accountId  = (req.query?.accountId || req.query?.id || "").trim();
    const appId      = (req.query?.appId || "").trim();
    const userId     = (req.query?.userId || "").trim();
    const entitlement= (req.query?.entitlement || "").trim();
    const search     = (req.query?.search || "").trim();
    const top        = Math.min(parseInt(req.query?.top || "200", 10), 500);
    const ct         = req.query?.continuationToken;

    if (!appId) return bad(400, "INVALID_INPUT", "Query param appId is required", req);

    const c = new CosmosClient(conn).database("appdb").container("accounts"); // PK: /appId

    if (accountId) {
      const { resources } = await c.items.query({
        query: "SELECT TOP 1 c.id, c.appId, c.userId, c.userName, c.email, c.entitlement, c.correlation, c.sod, c.isOrphan, c.isPrivileged, c.updatedAt, c.createdAt, c._etag, c._ts FROM c WHERE c.appId=@a AND c.id=@id",
        parameters: [{ name: "@a", value: appId }, { name: "@id", value: accountId }]
      }, { partitionKey: appId }).fetchAll();

      const account = resources?.[0] || null;
      if (!account) return bad(404, "ACCOUNT_NOT_FOUND", "Account not found", req);

      const etag = account._etag;
      const lastModified = toRfc1123(account._ts);
      if (isNotModified(req, etag, lastModified)) {
        return { status: 304, headers: withValidators(cors(req), etag, lastModified) };
      }

      return ok({ appId, account }, req, etag, lastModified);
    }

    let query = "SELECT c.id, c.appId, c.userId, c.userName, c.email, c.entitlement, c.correlation, c.sod, c.isOrphan, c.isPrivileged, c.updatedAt, c.createdAt, c._etag, c._ts FROM c WHERE c.appId=@a";
    const parameters = [{ name: "@a", value: appId }];
    if (userId) { query += " AND c.userId=@u"; parameters.push({ name: "@u", value: userId }); }
    if (entitlement) { query += " AND c.entitlement=@e"; parameters.push({ name: "@e", value: entitlement }); }
    if (search) {
      query += " AND (CONTAINS(LOWER(c.userId), @q) OR CONTAINS(LOWER(c.entitlement), @q) OR CONTAINS(LOWER(c.userName), @q) OR CONTAINS(LOWER(c.email), @q))";
      parameters.push({ name: "@q", value: search.toLowerCase() });
    }

    const iterator = c.items.query({ query, parameters }, { partitionKey: appId, maxItemCount: top, continuationToken: ct });
    const { resources, continuationToken } = await iterator.fetchNext();

    const items = resources || [];
    const { etag, lastModified } = listValidators(items);
    if (isNotModified(req, etag, lastModified)) {
      return { status: 304, headers: withValidators(cors(req), etag, lastModified) };
    }

    return ok({ appId, count: items.length, items, continuationToken }, req, etag, lastModified);
  } catch (err) {
    context.log.error("accounts-get error:", err?.stack || err);
    return bad(500, "INTERNAL_ERROR", err?.message || "Internal error", req);
  }
};

function cors(req){
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-functions-key, If-None-Match, If-Modified-Since"
  };
}
function ok(body, req, etag, lastModified){ return { status: 200, headers: withValidators(cors(req), etag, lastModified), body: { ok: true, ...body } }; }
function bad(status, code, message, req, details){
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { status, headers: cors(req), body: { ok: false, error } };
}

function toRfc1123(tsSeconds) {
  const millis = Number(tsSeconds || 0) * 1000;
  return new Date(millis > 0 ? millis : Date.now()).toUTCString();
}

function listValidators(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { etag: 'W/"accounts-empty"', lastModified: new Date(0).toUTCString() };
  }
  const etags = rows.map((r) => String(r?._etag || "")).filter(Boolean).sort();
  const maxTs = rows.reduce((max, row) => Math.max(max, Number(row?._ts || 0)), 0);
  return {
    etag: `W/\"accounts-${etags.join("|") || "none"}-${rows.length}-${maxTs}\"`,
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