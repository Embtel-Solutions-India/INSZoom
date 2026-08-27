const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./single-party-filing.controller");

// No isFamilyCapable/isEmployerCapable-style gate — there is no second party
// to protect a self-initiation rule against. Any account permitted to
// create a case at all (the existing "cases:create" permission, already
// granted to "client" — see authorization/permissions.registry.js) may
// start one of these single-party filings.
router.get("/types", authenticate, ctrl.getFilingTypes);
router.post(
  "/cases",
  authenticate,
  authorizeRoles("super_admin", "admin", "team_lead", "case_manager"),
  authorizePermissions("cases:create"),
  body("filingTypeKey").optional().isString(),
  body("fromStatus").optional().isString(),
  body("toStatus").optional().isString(),
  body("principalCaseRef").optional().isMongoId(),
  validate,
  ctrl.createFiling
);

module.exports = router;
