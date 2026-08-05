const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const authorizeRoles = require("../../middleware/authorizeRoles");
const validate = require("../../middleware/validate");
const controller = require("./petition-intelligence.controller");
const { ARTIFACT_TYPES } = require("./petition-intelligence.service");

const professionalRoles = ["super_admin", "admin", "team_lead", "case_manager"];

router.get("/cases/:caseId", authenticate, authorizeRoles(...professionalRoles), authorizePermissions("ai:read"), controller.list);
router.post(
  "/cases/:caseId/generate",
  authenticate,
  authorizeRoles(...professionalRoles),
  authorizePermissions("ai:create"),
  body("type").optional().isIn(Object.keys(ARTIFACT_TYPES)),
  body("focus").optional().isString().isLength({ max: 5000 }),
  body("templateInstructions").optional().isString().isLength({ max: 10000 }),
  validate,
  controller.generate
);

module.exports = router;
