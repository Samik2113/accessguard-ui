const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const cycleId = (req.query?.cycleId || "").trim();
    const appId = (req.query?.appId || "").trim();
    const managerId = (req.query?.managerId || "").trim();
    const status = (req.query?.status || "").trim().toUpperCase();
    const top = clampInt(req.query?.top ?? req.query?.limit, 1, 500, 200);
    const continuationToken = req.query?.continuationToken
      ? decodeURIComponent(req.query.continuationToken)
      : undefined;

    if (!cycleId) return bad(400, "INVALID_INPUT", "cycleId is required", req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "INTERNAL_ERROR", "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const db = client.database("appdb");
    const cyclesC = db.container("reviewCycles");
    const itemsC = db.container("reviewItems");

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

    let query = "SELECT c.id, c.reviewCycleId, c.appId, c.appName, c.managerId, c.appUserId, c.userName, c.entitlement, c.status, c.comment, c.actionedAt, c.remediatedAt, c.isSoDConflict, c.violatedPolicyIds, c.violatedPolicyNames, c.isOrphan, c.isPrivileged, c.reassignedAt, c.reassignedBy, c.reassignmentComment, c.reassignmentCount, c._etag, c._ts FROM c WHERE c.reviewCycleId=@id";
    const params = [{ name: "@id", value: cycle.id || cycle.cycleId }];

    if (managerId) {
      query += " AND c.managerId=@m";
      params.push({ name: "@m", value: managerId });
    }
    if (status) {
      query += " AND UPPER(c.status)=@s";
      params.push({ name: "@s", value: status });
    }

    query += " ORDER BY c.createdAt DESC";

    const iterator = itemsC.items.query(
      { query, parameters: params },
      {
        enableCrossPartitionQuery: true,
        maxItemCount: top,
        continuationToken
      }
    );

    const page = await iterator.fetchNext();
    const items = Array.isArray(page?.resources) ? page.resources : [];
    const nextToken = page?.continuationToken ? encodeURIComponent(page.continuationToken) : null;

    const maxItemTs = items.reduce((max, item) => Math.max(max, Number(item?._ts || 0)), 0);
    const lastTs = Math.max(Number(cycle?._ts || 0), maxItemTs);
    const lastModified = toRfc1123(lastTs);
    const compositeEtag = makeCompositeEtag(cycle._etag, maxItemTs, items.length);

    if (isNotModified(req, compositeEtag, lastModified)) {
      return { status: 304, headers: withValidators(cors(req), compositeEtag, lastModified) };
    }

    return {
      status: 200,
      headers: withValidators(cors(req), compositeEtag, lastModified),
      body: {
        ok: true,
        cycle,
        items,
        page: { count: items.length, continuationToken: nextToken },
        validators: { etag: compositeEtag, lastModified }
      }
    };
  } catch (err) {
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

function makeCompositeEtag(parentEtag, maxTs, itemCount) {
  return `W/\"cycle-detail-${String(parentEtag || "none")}-${Number(maxTs || 0)}-${Number(itemCount || 0)}\"`;
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
  makeCompositeEtag,
  toRfc1123
};