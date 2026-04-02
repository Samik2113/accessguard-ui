let joseModulePromise = null;
const jwksByTenant = new Map();

async function getJose() {
  if (!joseModulePromise) joseModulePromise = import('jose');
  return joseModulePromise;
}

async function getRemoteJwks(tenantId) {
  if (!jwksByTenant.has(tenantId)) {
    const { createRemoteJWKSet } = await getJose();
    jwksByTenant.set(tenantId, createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)));
  }
  return jwksByTenant.get(tenantId);
}

function normalizeBearerToken(req) {
  const header = String(req.headers?.authorization || req.headers?.Authorization || '').trim();
  if (!header.toLowerCase().startsWith('bearer ')) return '';
  return header.slice(7).trim();
}

async function verifyEntraAccessToken(token, opts = {}) {
  const tenantId = String(opts.tenantId || process.env.ENTRA_TENANT_ID || '').trim();
  const audience = String(opts.audience || process.env.ENTRA_API_AUDIENCE || '').trim();
  const audienceUri = String(opts.audienceUri || process.env.ENTRA_API_AUDIENCE_URI || '').trim();

  if (!tenantId) throw new Error('ENTRA_TENANT_ID not set');
  if (!audience && !audienceUri) throw new Error('ENTRA_API_AUDIENCE or ENTRA_API_AUDIENCE_URI not set');
  if (!token) throw new Error('Bearer token is required');

  const { jwtVerify } = await getJose();
  const jwks = await getRemoteJwks(tenantId);
  const result = await jwtVerify(token, jwks, {
    issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    audience: [audience, audienceUri].filter(Boolean)
  });
  return result.payload;
}

module.exports = {
  normalizeBearerToken,
  verifyEntraAccessToken
};