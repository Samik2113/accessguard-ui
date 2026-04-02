const { CosmosClient } = require('@azure/cosmos');
const { normalizeBearerToken, verifyEntraAccessToken } = require('../_shared/entra-auth');

function cors(req) {
  return {
    'Access-Control-Allow-Origin': req.headers?.origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-functions-key, x-actor-id, x-actor-name'
  };
}

function bad(status, error, req) {
  return { status, headers: cors(req), body: { ok: false, error } };
}

module.exports = async function (context, req) {
  try {
    if (req.method === 'OPTIONS') return { status: 204, headers: cors(req) };

    const token = normalizeBearerToken(req);
    if (!token) return bad(401, 'Authorization bearer token is required.', req);

    const conn = process.env.COSMOS_CONN;
    if (!conn) return bad(500, 'COSMOS_CONN not set', req);

    const claims = await verifyEntraAccessToken(token);
    const email = String(claims.preferred_username || claims.email || claims.upn || '').trim().toLowerCase();
    if (!email) return bad(401, 'Email claim was not found in Entra token.', req);

    const client = new CosmosClient(conn);
    const db = client.database('appdb');
    const authC = db.container('userAuth');
    const hrC = db.container('hrUsers');

    const authQuery = await authC.items.query({
      query: "SELECT TOP 1 * FROM c WHERE LOWER(c.email)=@email AND c.type=@type AND c.status='ACTIVE'",
      parameters: [
        { name: '@email', value: email },
        { name: '@type', value: 'user-auth' }
      ]
    }).fetchAll();

    const authUser = authQuery.resources?.[0];
    if (!authUser) return bad(403, 'This Entra account is not provisioned in AccessGuard.', req);

    let hrProfile = null;
    try {
      const read = await hrC.item(authUser.userId, authUser.userId).read();
      hrProfile = read?.resource || null;
    } catch (_) {
    }

    const roleRaw = String(authUser.role || 'USER').toUpperCase();
    const role = roleRaw === 'MANAGER' ? 'USER' : roleRaw;

    return {
      status: 200,
      headers: cors(req),
      body: {
        ok: true,
        user: {
          id: String(authUser.userId),
          userId: String(authUser.userId),
          name: String(hrProfile?.name || claims.name || authUser.userId),
          email,
          role: role === 'ADMIN' || role === 'AUDITOR' ? role : 'USER'
        },
        authProvider: 'ENTRA'
      }
    };
  } catch (err) {
    context.log.error('auth-sso-login error:', err?.stack || err);
    return bad(401, err?.message || 'SSO login failed', req);
  }
};