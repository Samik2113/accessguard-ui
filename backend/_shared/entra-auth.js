let joseModulePromise = null;
const jwksByTenant = new Map();
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJose() {
  if (!joseModulePromise) joseModulePromise = import('jose');
  return joseModulePromise;
}

async function getLocalJwks(tenantId) {
  const cached = jwksByTenant.get(tenantId);
  if (cached && Date.now() - cached.loadedAt < JWKS_TTL_MS) {
    return cached.jwks;
  }

  const response = await fetch(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Entra JWKS: HTTP ${response.status}`);
  }

  const body = await response.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  const normalizedKeys = keys
    .filter((key) => String(key?.use || '').toLowerCase() === 'sig')
    .filter((key) => String(key?.kty || '').toUpperCase() === 'RSA')
    .map((key) => {
      const clone = { ...key };
      delete clone.alg;
      return clone;
    });

  if (normalizedKeys.length === 0) {
    throw new Error('Entra JWKS did not contain any RSA signing keys.');
  }

  const { createLocalJWKSet } = await getJose();
  const jwks = createLocalJWKSet({ keys: normalizedKeys });
  jwksByTenant.set(tenantId, { jwks, loadedAt: Date.now() });
  return jwks;
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

  const { decodeProtectedHeader, jwtVerify } = await getJose();
  const header = decodeProtectedHeader(token);
  const alg = String(header?.alg || '');
  if (!['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512'].includes(alg)) {
    throw new Error(`Unsupported token signing algorithm: ${alg || 'unknown'}`);
  }

  const jwks = await getLocalJwks(tenantId);
  const acceptedIssuers = [
    `https://login.microsoftonline.com/${tenantId}/v2.0`,
    `https://sts.windows.net/${tenantId}/`,
    `https://sts.windows.net/${tenantId}`
  ];
  const result = await jwtVerify(token, jwks, {
    issuer: acceptedIssuers,
    audience: [audience, audienceUri].filter(Boolean),
    algorithms: [alg]
  });
  return result.payload;
}

module.exports = {
  normalizeBearerToken,
  verifyEntraAccessToken
};