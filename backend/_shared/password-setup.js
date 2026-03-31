const crypto = require("crypto");

const TOKEN_TTL_HOURS = Math.max(Number(process.env.PASSWORD_SETUP_TOKEN_TTL_HOURS || 24), 1);

function generateSetupToken() {
  return crypto.randomBytes(24).toString("hex");
}

function hashSetupToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function issuePasswordSetup(nowIso) {
  const issuedAt = nowIso || new Date().toISOString();
  const expiresAt = new Date(Date.parse(issuedAt) + TOKEN_TTL_HOURS * 60 * 60 * 1000).toISOString();
  const setupToken = generateSetupToken();
  return {
    setupToken,
    setupTokenHash: hashSetupToken(setupToken),
    setupTokenExpiresAt: expiresAt
  };
}

function verifyPasswordSetupToken(authUser, token) {
  const expectedHash = String(authUser?.setupTokenHash || "").trim();
  const expiresAt = String(authUser?.setupTokenExpiresAt || "").trim();
  if (!expectedHash || !expiresAt || !token) return false;
  if (Date.now() > Date.parse(expiresAt)) return false;

  const suppliedHash = hashSetupToken(token);
  return crypto.timingSafeEqual(Buffer.from(expectedHash, "hex"), Buffer.from(suppliedHash, "hex"));
}

module.exports = {
  issuePasswordSetup,
  verifyPasswordSetupToken
};
