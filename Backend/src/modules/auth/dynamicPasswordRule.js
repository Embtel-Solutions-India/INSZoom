const { body } = require("express-validator");
const settingsEngine = require("../settings/settingsEngine.service");

// Replaces every hardcoded `body(field).isLength({min:8})` password rule in
// auth.routes.js with a live check against security.password.* settings
// (settings/registry/security.registry.js) — an admin changing the minimum
// length/complexity requirement takes effect on the very next request, no
// restart, since getEffective reads through the settings-engine cache.
function dynamicPasswordRule(field = "password") {
  return body(field).custom(async (value) => {
    const [minLength, requireUpper, requireNumber, requireSymbol] = await Promise.all([
      settingsEngine.getEffective("security.password.minLength", {}),
      settingsEngine.getEffective("security.password.requireUpper", {}),
      settingsEngine.getEffective("security.password.requireNumber", {}),
      settingsEngine.getEffective("security.password.requireSymbol", {}),
    ]);
    if (typeof value !== "string" || value.length < minLength) {
      throw new Error(`Password must be at least ${minLength} characters`);
    }
    if (requireUpper && !/[A-Z]/.test(value)) throw new Error("Password must contain an uppercase letter");
    if (requireNumber && !/[0-9]/.test(value)) throw new Error("Password must contain a number");
    if (requireSymbol && !/[^A-Za-z0-9]/.test(value)) throw new Error("Password must contain a symbol");
    return true;
  });
}

module.exports = dynamicPasswordRule;
