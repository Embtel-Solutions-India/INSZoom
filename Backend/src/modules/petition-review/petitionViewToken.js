// A browser's PDF viewer loads its file by plain URL (it cannot send an Authorization header), and it asks for the file in byte ranges so the first page shows at once. The viewer
// link is therefore a signed token in the URL: bound to ONE petition and ONE person, valid for an hour, and re-checked against the live access rules on every request
// (petitionReview.service.openStream) - a token alone never outlives a withdrawn release or a deactivated account.
const jwt = require("jsonwebtoken");

const AUDIENCE = "petition-view";
const TTL_SECONDS = 60 * 60;

const secret = () => {
  const value = require("../../config/env").jwtAccessSecret || process.env.JWT_ACCESS_SECRET || process.env.JWT_SECRET;
  if (!value) throw new Error("No signing secret is configured");
  return `${value}:petition-view`; // a different key from the access tokens, derived from the same secret
};

function sign({ documentId, userId, side }, { now = Date.now(), ttlSeconds = TTL_SECONDS } = {}) {
  const issued = Math.floor(now / 1000);
  return jwt.sign({ doc: String(documentId), uid: String(userId), side, iat: issued, exp: issued + ttlSeconds }, secret(), { algorithm: "HS256", audience: AUDIENCE, noTimestamp: true });
}

/** The payload { doc, uid, side }, or null for anything that is not a valid, unexpired petition-view token. */
function verify(token, { now = Date.now() } = {}) {
  try {
    const payload = jwt.verify(String(token || ""), secret(), { algorithms: ["HS256"], audience: AUDIENCE, clockTimestamp: Math.floor(now / 1000) });
    return payload?.doc && payload?.uid && (payload.side === "client" || payload.side === "staff" || payload.side === "attorney") ? { doc: payload.doc, uid: payload.uid, side: payload.side } : null;
  } catch {
    return null;
  }
}

module.exports = { sign, verify, TTL_SECONDS };
