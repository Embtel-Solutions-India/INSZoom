const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const ctrl = require("./fee-schedule.controller");

// Internal staff reference only - readable by all four staff roles (a
// case_manager has legitimate reason to know these fees even though the
// Fee Schedule sidebar link itself is only shown to super_admin/admin/
// team_lead - client/employee/employer/beneficiary get 403).
router.get(
  "/",
  authenticate,
  authorizeRoles("super_admin", "admin", "team_lead", "case_manager"),
  ctrl.list
);

module.exports = router;
