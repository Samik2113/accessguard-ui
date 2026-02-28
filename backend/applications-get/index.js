const { CosmosClient } = require("@azure/cosmos");
const api = require('../dist/services/api');

module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const top = Math.min(parseInt(req.query?.top || "100", 10), 500);
    const ct  = req.query?.continuationToken;

    const c = new CosmosClient(conn).database("appdb").container("applications"); // PK: /appId
    const iterator = c.items.query("SELECT * FROM c", { maxItemCount: top, continuationToken: ct });
    const { resources, continuationToken } = await iterator.fetchNext();

    return ok({ count: resources.length, items: resources, continuationToken }, req);
  } catch (err) {
    context.log.error("applications-get error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};

function cors(req){ return { "Access-Control-Allow-Origin": req.headers?.origin || "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, error, req){ return { status, headers: cors(req), body: { ok: false, error } }; }