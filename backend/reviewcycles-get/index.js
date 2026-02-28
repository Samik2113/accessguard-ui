// /reviewcycles-get/index.js
const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const cycleId = (req.query?.cycleId || "").trim();
    const appId = (req.query?.appId || "").trim();
    const status = (req.query?.status || "").trim().toUpperCase();
    const limit = clampInt(req.query?.limit, 1, 500, 200); // default 200, max 500

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "INTERNAL_ERROR", "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const cyclesC = client.database("appdb").container("reviewCycles"); // PK: /appId

    if (cycleId) {
      let cycle = null;

      if (appId) {
        const { resources } = await cyclesC.items.query({
          query: "SELECT TOP 1 c.id, c.cycleId, c.name, c.appId, c.appName, c.status, c.launchedAt, c.dueDate, c.completedAt, c.totalItems, c.pendingItems, c.pendingRemediationItems, c.confirmedManagers, c._etag, c._ts FROM c WHERE (c.id=@id OR c.cycleId=@id) AND c.appId=@a",
          parameters: [{ name: "@id", value: cycleId }, { name: "@a", value: appId }]
        }, { partitionKey: appId }).fetchAll();
        cycle = resources?.[0] || null;
      } else {
        const { resources } = await cyclesC.items.query({
          query: "SELECT TOP 1 c.id, c.cycleId, c.name, c.appId, c.appName, c.status, c.launchedAt, c.dueDate, c.completedAt, c.totalItems, c.pendingItems, c.pendingRemediationItems, c.confirmedManagers, c._etag, c._ts FROM c WHERE c.id=@id OR c.cycleId=@id",
          parameters: [{ name: "@id", value: cycleId }]
        }, { enableCrossPartitionQuery: true }).fetchAll();
        cycle = resources?.[0] || null;
      }

      if (!cycle) return bad(404, "CYCLE_NOT_FOUND", "Review cycle not found", req);

      const etag = cycle._etag;
      const lastModified = toRfc1123(cycle._ts);
      if (isNotModified(req, etag, lastModified)) {
        return { status: 304, headers: withValidators(cors(req), etag, lastModified) };
      }

      return ok({ cycle }, req, etag, lastModified);
    }

    // ----------------------------------------
    // A) If appId provided -> partitioned query
    // ----------------------------------------
    if (appId) {
      let query = "SELECT c.id, c.cycleId, c.name, c.appId, c.appName, c.status, c.launchedAt, c.dueDate, c.completedAt, c.totalItems, c.pendingItems, c.pendingRemediationItems, c.confirmedManagers, c._etag, c._ts FROM c WHERE c.appId=@a";
      const params = [{ name: "@a", value: appId }];
      if (status) {
        query += " AND UPPER(c.status)=@s";
        params.push({ name: "@s", value: status });
      }
      // Partition-targeted query with partitionKey
      const { resources } = await cyclesC.items
        .query({ query, parameters: params }, { partitionKey: appId })
        .fetchAll();

      const cycles = (resources || []).slice(0, limit);
      const { etag, lastModified } = listValidators(cycles);
      if (isNotModified(req, etag, lastModified)) {
        return { status: 304, headers: withValidators(cors(req), etag, lastModified) };
      }
      return ok({ mode: "BY_APPID", appId, count: cycles.length, cycles }, req, etag, lastModified);
    }

    // -----------------------------------------------------
    // B) No appId -> cross-partition query across all apps
    // -----------------------------------------------------
    let queryAll =
      "SELECT c.id, c.cycleId, c.name, c.appId, c.appName, c.status, c.launchedAt, c.dueDate, c.completedAt, c.totalItems, c.pendingItems, c.pendingRemediationItems, c.confirmedManagers, c._etag, c._ts FROM c WHERE c.type = 'review-cycle'"; // make sure your cycle docs have type set
    const paramsAll = [];

    if (status) {
      queryAll += " AND UPPER(c.status)=@s";
      paramsAll.push({ name: "@s", value: status });
    }

    // Optional: order by launch time if you store it as ISO string
    queryAll += " ORDER BY c.launchedAt DESC";

    // Cross-partition query (do NOT pass partitionKey here)
    const { resources: allCycles } = await cyclesC.items
      .query({ query: queryAll, parameters: paramsAll }, { enableCrossPartitionQuery: true })
      .fetchAll();

    const cycles = (allCycles || []).slice(0, limit);
    const { etag, lastModified } = listValidators(cycles);
    if (isNotModified(req, etag, lastModified)) {
      return { status: 304, headers: withValidators(cors(req), etag, lastModified) };
    }
    return ok({ mode: "ALL", count: cycles.length, cycles }, req, etag, lastModified);
  } catch (err) {
    context.log.error("reviewcycles-get error:", err?.stack || err);
    return bad(500, "INTERNAL_ERROR", err?.message || "Internal error", req);
  }
};

function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-functions-key, If-None-Match, If-Modified-Since"
  };
}
function ok(body, req, etag, lastModified) {
  const headers = withValidators(cors(req), etag, lastModified);
  return { status: 200, headers, body: { ok: true, ...body } };
}
function bad(status, code, message, req, details) {
  const error = { code, message };
  if (details !== undefined) error.details = details;
  return { status, headers: cors(req), body: { ok: false, error } };
}
function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  return dflt;
}

function toRfc1123(tsSeconds) {
  const millis = Number(tsSeconds || 0) * 1000;
  return new Date(millis > 0 ? millis : Date.now()).toUTCString();
}

function listValidators(cycles) {
  if (!Array.isArray(cycles) || cycles.length === 0) {
    return { etag: 'W/"reviewcycles-empty"', lastModified: new Date(0).toUTCString() };
  }
  const etags = cycles.map((c) => String(c?._etag || "")).filter(Boolean).sort();
  const maxTs = cycles.reduce((max, c) => Math.max(max, Number(c?._ts || 0)), 0);
  const etag = `W/\"reviewcycles-${etags.join("|") || "none"}-${cycles.length}-${maxTs}\"`;
  return { etag, lastModified: toRfc1123(maxTs) };
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