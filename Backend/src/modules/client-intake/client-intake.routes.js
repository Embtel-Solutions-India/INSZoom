const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./client-intake.controller");

const readRoles = ["super_admin", "admin", "team_lead", "case_manager", "client", "user"];
const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];

router.get("/me", authenticate, authorizeRoles(...readRoles), authorizePermissions("clients:read"), ctrl.getMyIntake);
router.put(
  "/me",
  authenticate,
  authorizeRoles(...readRoles),
  authorizePermissions("clients:update"),
  body("caseId").optional().isMongoId(),
  validate,
  ctrl.saveMyIntake
);
router.post(
  "/me/submit",
  authenticate,
  authorizeRoles("client", "user"),
  authorizePermissions("clients:update"),
  body("caseId").optional().isMongoId(),
  validate,
  ctrl.submitMyIntake
);
router.get("/cases/:caseId", authenticate, authorizeRoles(...staffRoles), authorizePermissions("clients:read"), ctrl.getCaseIntake);

module.exports = router;
