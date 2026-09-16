const { hasPermission } = require("../modules/authorization/rbac.service");

// Baseline gate for every /api/settings-v2 route. Per-key permission
// checks (registry entry.requiresPermission, which varies per key/category)
// happen inside settingsEngine.service.js itself — a single bulk PATCH can
// touch keys with different required permissions, so that check can't live
// at the route level. This middleware only rejects a token holding NONE of
// the settings permissions at all, failing fast before the service runs.
function requireSettingPermission(minPermission = "settings:view") {
  return (req, res, next) => {
    if (!hasPermission(req.user, minPermission)) {
      return res.status(403).json({ success: false, message: "Missing required permission" });
    }
    next();
  };
}

module.exports = requireSettingPermission;
