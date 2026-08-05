const { hasPermission } = require("../modules/authorization/rbac.service");

function authorizePermissions(...permissions) {
  return (req, res, next) => {
    const allowed = permissions.every((permission) => hasPermission(req.user, permission));
    if (!allowed) {
      return res.status(403).json({ success: false, message: "Missing required permission" });
    }
    next();
  };
}

module.exports = authorizePermissions;
