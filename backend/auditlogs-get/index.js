const { CosmosClient } = require("@azure/cosmos");

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };
    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const userId = (req.query?.userId || "").trim();
    const action = (req.query?.action || "").trim().toUpperCase();
    const from   = req.query?.from ? new Date(req.query.from).toISOString() : null;
    const to     = req.query?.to   ? new Date(req.query.to).toISOString()   : null;
    const top    = Math.min(parseInt(req.query?.top || "100", 10), 500);
    const ct     = req.query?.continuationToken;

    let query = "SELECT * FROM c WHERE 1=1";
    const parameters = [];
    if (userId) { query += " AND c.userId=@u"; parameters.push({ name: "@u", value: userId }); }
    if (action) { query += " AND UPPER(c.action)=@a"; parameters.push({ name: "@a", value: action }); }
    if (from)   { query += " AND c.timestamp >= @f"; parameters.push({ name: "@f", value: from }); }
    if (to)     { query += " AND c.timestamp <= @t"; parameters.push({ name: "@t", value: to }); }

    const c = new CosmosClient(conn).database("appdb").container("auditLogs"); // PK: /userId
    const options = { maxItemCount: top, continuationToken: ct };
    if (userId) options.partitionKey = userId; // single-partition when possible

    const iterator = c.items.query({ query, parameters }, options);
    const { resources, continuationToken } = await iterator.fetchNext();

    return ok({ count: resources.length, items: resources, continuationToken }, req);
  } catch (err) {
    context.log.error("auditlogs-get error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};

function cors(req){ return { "Access-Control-Allow-Origin": req.headers?.origin || "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, error, req){ return { status, headers: cors(req), body: { ok: false, error } }; }