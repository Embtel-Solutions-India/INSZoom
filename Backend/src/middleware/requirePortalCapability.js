const settingsEngine = require("../modules/settings/settingsEngine.service");

// Settings → Client Portal (settings/registry/portal.registry.js). Gates a
// route ONLY for client-side requesters — staff acting on a case (uploading
// on a client's behalf, messaging a client, viewing payment records for
// finance/reporting purposes) are never blocked by a client-facing portal
// toggle. `clientRoles` defaults to the app's actual client-portal role set
// (mirrors AuthGate.jsx's CLIENT_PORTAL_ROLES on the frontend).
const DEFAULT_CLIENT_ROLES = new Set(["client", "user", "employer", "employee", "beneficiary"]);

function requirePortalCapability(settingKey, clientRoles = DEFAULT_CLIENT_ROLES) {
  return async (req, res, next) => {
    try {
      if (!clientRoles.has(req.user?.role)) return next(); // staff request — not gated
      const enabled = await settingsEngine.getEffective(settingKey, {});
      if (!enabled) {
        return res.status(403).json({ success: false, message: "This action is currently disabled for the client portal.", code: "PORTAL_CAPABILITY_DISABLED" });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = requirePortalCapability;
