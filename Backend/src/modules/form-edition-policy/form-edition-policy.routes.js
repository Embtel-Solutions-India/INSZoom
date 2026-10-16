// Form edition policy API (plan Rule D). The 0b-1 manual submit / decide endpoints were removed in 0b-2: acceptance is automatic. EXACTLY the roles admin and team_lead - never super_admin.
//
// authorizeRoles is the exact-match guard (hasRole: the user's role must be in the list). authorizePermissions is deliberately NOT used: it admits
// every super_admin, any user holding "*" or "form-edition:*", and honors runtime-editable permission overrides, any of which would break the
// exact-role rule. EvidenceService re-checks the role on every call as well.
const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const { EVIDENCE_ROLES } = require("./editionPolicy.constants");
const controller = require("./form-edition-policy.controller");

router.use(authenticate, authorizeRoles(...EVIDENCE_ROLES));

router.get("/editions", controller.listEditions);
router.get("/gate", controller.checkGate);
// Nobody submits evidence or records a decision by hand: the system finds the official page / PDF, reads the edition and records the decision itself
// (at every activation attempt and after each 12-hourly catalog sync). This only runs that same automatic check on demand.
router.post("/auto-check", controller.autoCheck);

module.exports = router;
