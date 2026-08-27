const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const ctrl = require("./employer-profile.controller");

// Mixed staff+client audience (the employer client themselves, any of their
// invited employees for read-only access, and staff) — access is enforced
// inside the service layer via canRead/canWrite, matching the pattern
// case.controller.js already uses for client-accessible case routes
// (canAccessCase), not the staff-only authorizeRoles/authorizePermissions
// gates used elsewhere in this app.
router.get("/:principalCaseId", authenticate, ctrl.getEmployerProfile);
router.post("/:principalCaseId", authenticate, ctrl.upsertEmployerProfile);

module.exports = router;
