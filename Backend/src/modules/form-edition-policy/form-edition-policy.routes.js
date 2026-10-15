// Release 0b-1 evidence-resolution API (plan Rule D). EXACTLY the roles admin and team_lead - never super_admin.
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
router.post("/evidence", controller.submitEvidence);
router.get("/evidence/:evidenceCaseId", controller.getEvidenceCase);
router.post("/evidence/:evidenceCaseId/decision", controller.recordDecision);

module.exports = router;
