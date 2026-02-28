const { CosmosClient } = require("@azure/cosmos");
const api = require('../dist/services/api');
module.exports = async function (context, req) {
  try {
    if (req.method === "OPTIONS") return { status: 204, headers: cors(req) };

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, "COSMOS_CONN not set", req);

    const client = new CosmosClient(conn);
    const c = client.database("appdb").container("hrUsers"); // PK: /userId

    const userId    = (req.query?.userId || "").trim();
    const managerId = (req.query?.managerId || "").trim();
    const search    = (req.query?.search || "").trim().toLowerCase();
    const top       = Math.min(parseInt(req.query?.top || "50", 10), 200);
    const ct        = req.query?.continuationToken;

    // Fast point-read when userId provided
    if (userId) {
      const { resource } = await c.item(userId, userId).read().catch(() => ({ resource: null }));
      return ok({ count: resource ? 1 : 0, items: resource ? [resource] : [] }, req);
    }

    // Cross-partition search (admin use)
    let query = "SELECT * FROM c WHERE 1=1";
    const parameters = [];
    if (managerId) { query += " AND c.managerId=@m"; parameters.push({ name: "@m", value: managerId }); }
    if (search) {
      query += " AND (CONTAINS(LOWER(c.name), @s) OR CONTAINS(LOWER(c.email), @s) OR CONTAINS(LOWER(c.userId), @s))";
      parameters.push({ name: "@s", value: search });
    }

    const iterator = c.items.query({ query, parameters }, { maxItemCount: top, continuationToken: ct });
    const { resources, continuationToken } = await iterator.fetchNext();

    return ok({ count: resources.length, items: resources, continuationToken }, req);
  } catch (err) {
    context.log.error("hr-users-get error:", err?.stack || err);
    return bad(500, err?.message || "Internal error", req);
  }
};

function cors(req){ return { "Access-Control-Allow-Origin": req.headers?.origin || "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization" }; }
function ok(body, req){ return { status: 200, headers: cors(req), body: { ok: true, ...body } }; }
function bad(status, error, req){ return { status, headers: cors(req), body: { ok: false, error } }; }