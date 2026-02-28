// /reviewcycles-get/index.js
const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const appId = (req.query?.appId || "").trim();
    const status = (req.query?.status || "").trim().toUpperCase();
    const limit = clampInt(req.query?.limit, 1, 500, 200); // default 200, max 500

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const cyclesC = client.database("appdb").container("reviewCycles"); // PK: /appId

    // ----------------------------------------
    // A) If appId provided -> partitioned query
    // ----------------------------------------
    if (appId) {
      let query = "SELECT * FROM c WHERE c.appId=@a";
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
      return ok({ mode: "BY_APPID", appId, count: cycles.length, cycles }, req);
    }

    // -----------------------------------------------------
    // B) No appId -> cross-partition query across all apps
    // -----------------------------------------------------
    let queryAll =
      "SELECT * FROM c WHERE c.type = 'review-cycle'"; // make sure your cycle docs have type set
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
    return ok({ mode: "ALL", count: cycles.length, cycles }, req);
  } catch (err) {
    context.log.error("reviewcycles-get error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};

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