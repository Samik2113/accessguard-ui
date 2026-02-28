const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };
    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const search = (req.query?.search || "").trim().toUpperCase();
    const top    = Math.min(parseInt(req.query?.top || "100", 10), 500);
    const ct     = req.query?.continuationToken;

    let query = "SELECT * FROM c WHERE 1=1";
    const parameters = [];
    if (search) {
      query += " AND (CONTAINS(UPPER(c.entitlement1), @s) OR CONTAINS(UPPER(c.entitlement2), @s) OR CONTAINS(UPPER(c.policyName), @s))";
      parameters.push({ name: "@s", value: search });
    }

    const c = new CosmosClient(conn).database("appdb").container("sodPolicies");
    const iterator = c.items.query({ query, parameters }, { maxItemCount: top, continuationToken: ct });
    const { resources, continuationToken } = await iterator.fetchNext();

    return ok({ count: resources.length, items: resources, continuationToken }, req);
  } catch (err) {
    context.log.error("sod-get error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};


function cors(req){ return { "Access-Control-Allow-Origin": req.headers?.origin || "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, error, req){ return { status, headers: cors(req), body: { ok: false, error } }; }