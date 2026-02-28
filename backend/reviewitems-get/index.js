const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    // managerId is OPTIONAL for reads
    const managerId = (req.query?.managerId || "").trim();
    const status = (req.query?.status || "").trim().toUpperCase(); // optional
    const appId = (req.query?.appId || "").trim(); // optional
    const reviewCycleId = (req.query?.reviewCycleId || "").trim(); // optional

    // Accept both ?limit= and ?top= (alias)
    const limitParam = req.query?.limit ?? req.query?.top;
    const limit = clampInt(limitParam, 1, 500, 200); // default 200, max 500

    // Continuation token (URL-encoded opaque string)
    const continuationToken = req.query?.continuationToken
      ? decodeURIComponent(req.query.continuationToken)
      : undefined;

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const itemsC = client.database("appdb").container("reviewItems"); // PK: /managerId

    // -----------------------------------------------------------------
    // A) managerId provided => single-partition query (fast & cheapest)
    // -----------------------------------------------------------------
    if (managerId) {
      let query = "SELECT * FROM c WHERE c.managerId=@m";
      const params = [{ name: "@m", value: managerId }];

      if (status) {
        query += " AND UPPER(c.status)=@s";
        params.push({ name: "@s", value: status });
      }
      if (appId) {
        query += " AND c.appId=@a";
        params.push({ name: "@a", value: appId });
      }
      if (reviewCycleId) {
        query += " AND c.reviewCycleId=@rc";
        params.push({ name: "@rc", value: reviewCycleId });
      }

      const iterator = itemsC.items.query(
        { query, parameters: params },
        {
          partitionKey: managerId,
          maxItemCount: limit,
          continuationToken
        }
      );

      const page = await iterator.fetchNext();
      const rows = Array.isArray(page?.resources) ? page.resources : [];
      const nextToken = page?.continuationToken ? encodeURIComponent(page.continuationToken) : null;

      return ok(
        {
          mode: "BY_MANAGER",
          managerId,
          count: rows.length,
          continuationToken: nextToken,
          items: rows
        },
        req
      );
    }

    // -----------------------------------------------------------------
    // B) No managerId => cross-partition query (broader, more RU)
    // -----------------------------------------------------------------
    let queryAll = "SELECT * FROM c WHERE c.type = 'review-item'";
    const paramsAll = [];

    if (status) {
      queryAll += " AND UPPER(c.status)=@s";
      paramsAll.push({ name: "@s", value: status });
    }
    if (appId) {
      queryAll += " AND c.appId=@a";
      paramsAll.push({ name: "@a", value: appId });
    }
    if (reviewCycleId) {
      queryAll += " AND c.reviewCycleId=@rc";
      paramsAll.push({ name: "@rc", value: reviewCycleId });
    }

    // Optional ORDER BY — safe to remove if you don't need ordering
    queryAll += " ORDER BY c.createdAt DESC";

    const iterator = itemsC.items.query(
      { query: queryAll, parameters: paramsAll },
      {
        enableCrossPartitionQuery: true,
        maxItemCount: limit,
        continuationToken
      }
    );

    const page = await iterator.fetchNext();
    const rows = Array.isArray(page?.resources) ? page.resources : [];
    const nextToken = page?.continuationToken ? encodeURIComponent(page.continuationToken) : null;

    return ok(
      {
        mode: "ALL",
        count: rows.length,
        continuationToken: nextToken,
        items: rows
      },
      req
    );
  } catch (err) {
    // More defensive logging
    const msg = err?.message || String(err);
    context.log.error("reviewItems GET error:", msg, err?.stack || "");
    return bad(500, msg, req);
  }
};

// ------------------------------------------------------
// Helpers
// ------------------------------------------------------
function cors(req) {
  return {
    "Access-Control-Allow-Origin": req.headers?.origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
function ok(body, req) {
  return { status: 200, headers: cors(req), body: { ok: true, ...body } };
}
function bad(status, error, req) {
  return { status, headers: cors(req), body: { ok: false, error } };
}
function clampInt(v, min, max, dflt) {
  const n = parseInt(v, 10);
  if (Number.isFinite(n)) return Math.min(max, Math.max(min, n));
  return dflt;
}