const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };
    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const appId      = (req.query?.appId || "").trim();
    const userId     = (req.query?.userId || "").trim();
    const entitlement= (req.query?.entitlement || "").trim();
    const top        = Math.min(parseInt(req.query?.top || "200", 10), 500);
    const ct         = req.query?.continuationToken;

    if (!appId) return bad(400, "Query param appId is required", req);

    let query = "SELECT * FROM c WHERE c.appId=@a";
    const parameters = [{ name: "@a", value: appId }];
    if (userId) { query += " AND c.userId=@u"; parameters.push({ name: "@u", value: userId }); }
    if (entitlement) { query += " AND c.entitlement=@e"; parameters.push({ name: "@e", value: entitlement }); }

    const c = new CosmosClient(conn).database("appdb").container("accounts"); // PK: /appId
    const iterator = c.items.query({ query, parameters }, { partitionKey: appId, maxItemCount: top, continuationToken: ct });
    const { resources, continuationToken } = await iterator.fetchNext();

    return ok({ appId, count: resources.length, items: resources, continuationToken }, req);
  } catch (err) {
    context.log.error("accounts-get error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};

function cors(req){ return { "Access-Control-Allow-Origin": req.headers?.origin || "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, error, req){ return { status, headers: cors(req), body: { ok: false, error } }; }