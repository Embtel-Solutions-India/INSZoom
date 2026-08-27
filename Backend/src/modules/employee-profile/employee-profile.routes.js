const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const ctrl = require("./employee-profile.controller");

// Scoped to exactly one child case's profile — see canAccess() in
// employee-profile.service.js. Mixed staff+client audience, so access is
// enforced in the service layer rather than via authorizeRoles/Permissions.
router.get("/:caseId", authenticate, ctrl.getEmployeeProfile);
router.post("/:caseId", authenticate, ctrl.upsertEmployeeProfile);

module.exports = router;
