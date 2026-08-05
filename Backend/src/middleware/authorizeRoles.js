const { hasRole } = require("../modules/authorization/rbac.service");

function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!hasRole(req.user, roles)) {
      return res.status(403).json({
        success: false,
        message: `User role ${req.user?.role || "unknown"} is not authorized to access this route`,
      });
    }
    next();
  };
}

module.exports = authorizeRoles;
