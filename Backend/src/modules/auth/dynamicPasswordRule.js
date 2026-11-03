const { body } = require("express-validator");
const settingsEngine = require("../settings/settingsEngine.service");

// Replaces every hardcoded `body(field).isLength({min:8})` password rule in
// auth.routes.js with a live check against security.password.* settings
// (settings/registry/security.registry.js) — an admin changing the minimum
// length/complexity requirement takes effect on the very next request, no
// restart, since getEffective reads through the settings-engine cache.
// The special characters named in every password message. Any non-alphanumeric character counts as a symbol, so these (and others) are all accepted.
const ALLOWED_SYMBOLS = "! @ # $ % & * . -";

// One sentence listing what a password needs, built from the live settings, so the message always matches what is enforced.
function requirementText({ minLength, requireUpper, requireNumber, requireSymbol }) {
  const parts = [];
  if (requireUpper) parts.push("one uppercase letter");
  parts.push("one lowercase letter");
  if (requireNumber) parts.push("one digit");
  if (requireSymbol) parts.push(`one special character (${ALLOWED_SYMBOLS})`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `Password must be at least ${minLength} characters and include ${list}.${requireSymbol ? "" : ` These special characters are allowed: ${ALLOWED_SYMBOLS}.`}`;
}

function dynamicPasswordRule(field = "password") {
  return body(field).custom(async (value) => {
    const [minLength, requireUpper, requireNumber, requireSymbol] = await Promise.all([
      settingsEngine.getEffective("security.password.minLength", {}),
      settingsEngine.getEffective("security.password.requireUpper", {}),
      settingsEngine.getEffective("security.password.requireNumber", {}),
      settingsEngine.getEffective("security.password.requireSymbol", {}),
    ]);
    const message = requirementText({ minLength, requireUpper, requireNumber, requireSymbol });
    if (typeof value !== "string" || value.length < minLength) throw new Error(message);
    if (requireUpper && !/[A-Z]/.test(value)) throw new Error(message);
    if (!/[a-z]/.test(value)) throw new Error(message);
    if (requireNumber && !/[0-9]/.test(value)) throw new Error(message);
    if (requireSymbol && !/[^A-Za-z0-9]/.test(value)) throw new Error(message);
    return true;
  });
}

module.exports = dynamicPasswordRule;
module.exports.requirementText = requirementText;
module.exports.ALLOWED_SYMBOLS = ALLOWED_SYMBOLS;
