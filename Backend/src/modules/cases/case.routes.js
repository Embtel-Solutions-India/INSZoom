const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./case.controller");
const { PRIORITIES } = require("./case.constants");
const { PACKAGE_NAMES } = require("../../config/packages");

const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const managerRoles = ["super_admin", "admin", "team_lead", "case_manager"];

router.get("/my", authenticate, ctrl.getMyCase);
router.get("/config", authenticate, authorizePermissions("cases:read"), ctrl.getCaseConfig);
router.get("/dashboard/stats", authenticate, authorizePermissions("cases:read"), ctrl.getDashboardStats);
router.get("/dashboard/team-lead", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("cases:read"), ctrl.getTeamLeadDashboard);
router.get("/dashboard/needs-attention", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("cases:read"), ctrl.getNeedsAttention);
router.get("/dashboard/recent-activity", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("cases:read"), ctrl.getRecentActivity);
router.post("/bulk", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:update"), ctrl.bulkActions);
router.get("/", authenticate, authorizePermissions("cases:read"), ctrl.getCases);
router.post(
  "/",
  authenticate,
  authorizePermissions("cases:create"),
  body("visaType").notEmpty().withMessage("Visa type is required"),
  body("clientEmail").optional().isEmail().withMessage("Valid client email is required"),
  validate,
  ctrl.createCase
);
router.post(
  "/create-with-client",
  authenticate,
  authorizeRoles(...staffRoles),
  authorizePermissions("cases:create"),
  body("clientName").trim().notEmpty().withMessage("Client name is required"),
  body("clientEmail").isEmail().normalizeEmail().withMessage("Valid client email is required"),
  body("visaType").notEmpty().withMessage("Visa type is required"),
  body("packageName").optional({ checkFalsy: true }).isIn(PACKAGE_NAMES).withMessage(`Package must be one of: ${PACKAGE_NAMES.join(", ")}`),
  body("clientPhone").optional().isString(),
  body("assignedCaseManager").optional().isMongoId().withMessage("assignedCaseManager must be a valid ID"),
  body("employerName").optional({ checkFalsy: true }).isString(),
  body("employerEmail").optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage("Valid employer email is required"),
  body("employerCompletionMode").optional({ checkFalsy: true }).isIn(["employer_completes", "invite_employees"]).withMessage("Invalid employer workflow option"),
  body("caseDetails").optional({ checkFalsy: true }).isString(),
  validate,
  ctrl.createCaseWithClient
);
router.get("/:id/addons", authenticate, authorizePermissions("cases:read"), ctrl.getAvailableAddons);
router.post(
  "/:id/addons/:addonKey/purchase",
  authenticate,
  authorizePermissions("payments:create"),
  ctrl.purchaseAddon
);
router.get("/:id", authenticate, authorizePermissions("cases:read"), ctrl.getCase);
router.put("/:id", authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:update"), ctrl.updateCase);
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("cases:delete"), ctrl.archiveCase);

router.put("/:id/stage", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:update"), ctrl.updateCaseStage);
router.post("/:id/notes", authenticate, authorizeRoles(...staffRoles), body("note").notEmpty().withMessage("Note is required"), validate, ctrl.addInternalNote);
router.post("/:id/external-notes", authenticate, body("note").notEmpty().withMessage("Note is required"), validate, ctrl.addExternalNote);
router.put(
  "/:id/assign-case-manager",
  authenticate,
  authorizeRoles("super_admin", "admin", "team_lead"),
  authorizePermissions("cases:assign"),
  body("caseManagerId").notEmpty(),
  body("priority").optional().isIn(PRIORITIES).withMessage("Invalid priority"),
  body("internalNote").optional().isString(),
  validate,
  ctrl.assignCaseManager
);
router.put("/:id/assign-team-lead", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("cases:assign"), ctrl.assignTeamLead);
router.put("/:id/ownership", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), authorizePermissions("cases:assign"), ctrl.transferOwnership);
// Alias matching the enterprise reassignment spec's endpoint shape
// (POST .../reassign with { toManagerId, reason }) — reuses assignCaseManager
// rather than duplicating its validation/event/notification/realtime logic.
router.post(
  "/:id/reassign",
  authenticate,
  authorizeRoles("super_admin", "admin", "team_lead"),
  authorizePermissions("cases:assign"),
  body("toManagerId").notEmpty().withMessage("toManagerId is required"),
  body("reason").optional().isString(),
  validate,
  (req, res, next) => {
    req.body.caseManagerId = req.body.toManagerId;
    next();
  },
  ctrl.assignCaseManager
);
router.get("/:id/assignment-history", authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:read"), ctrl.getAssignmentHistory);
router.put("/:id/assign-beneficiary", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:assign"), body("beneficiaryId").notEmpty(), validate, ctrl.assignBeneficiary);
router.put("/:id/assign-company", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:assign"), body("companyId").notEmpty(), validate, ctrl.assignCompany);
router.put("/:id/assign-client", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:assign"), body("clientId").notEmpty(), validate, ctrl.assignClient);
router.post("/:id/linked-cases", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:update"), body("linkedCaseId").notEmpty(), validate, ctrl.linkCase);
router.get("/:id/related", authenticate, authorizePermissions("cases:read"), ctrl.getRelated);
router.get("/:id/timeline", authenticate, authorizePermissions("cases:read"), ctrl.getTimeline);
router.get("/:id/workflow", authenticate, authorizePermissions("cases:read"), ctrl.getCaseWorkflow);
router.get("/:id/knowledge-plan", authenticate, authorizePermissions("cases:read"), ctrl.getKnowledgePlan);
router.post("/:id/workflow/recalculate", authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:update"), ctrl.recalculateCaseWorkflow);
router.post("/:id/knowledge-plan/refresh", authenticate, authorizeRoles(...staffRoles), authorizePermissions("cases:update"), ctrl.refreshKnowledgePlan);
router.post("/:id/workflow/generate-forms", authenticate, authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("forms:update"), ctrl.generateCaseForms);
router.post("/:id/workflow/generate-package", authenticate, authorizeRoles("super_admin", "admin", "case_manager"), authorizePermissions("forms:update"), ctrl.generateCasePackage);
router.post("/:id/workflow/generate-word-package", authenticate, authorizeRoles("super_admin", "admin", "case_manager"), authorizePermissions("forms:update"), ctrl.generateCaseWordPackage);
router.put("/:id/reopen", authenticate, authorizeRoles(...managerRoles), authorizePermissions("cases:update"), ctrl.reopenCase);

router.post("/:id/document-references", authenticate, authorizeRoles(...staffRoles), body("documentId").notEmpty(), validate, ctrl.addDocumentReference);
router.post("/:id/uscis-form-references", authenticate, authorizeRoles(...staffRoles), body("refId").notEmpty(), validate, ctrl.addUSCISFormReference);
router.post("/:id/questionnaire-references", authenticate, authorizeRoles(...staffRoles), ctrl.addQuestionnaireReference);
router.post("/:id/send-questionnaire", authenticate, authorizeRoles(...managerRoles), ctrl.sendQuestionnaire);
router.post("/:id/submit-questionnaire", authenticate, ctrl.submitQuestionnaire);
router.post("/:id/approve-questionnaire", authenticate, authorizeRoles(...managerRoles), ctrl.approveQuestionnaire);
router.post("/:id/request-documents", authenticate, authorizeRoles(...managerRoles), ctrl.requestDocuments);

router.post("/:id/checklist/:idx/upload", authenticate, ctrl.checklistUploadMiddleware, ctrl.uploadChecklistFile);
router.put("/:id/checklist/:idx", authenticate, authorizeRoles(...staffRoles), ctrl.updateChecklistItem);
router.post("/:id/checklist/generate", authenticate, authorizeRoles(...staffRoles), ctrl.generateCaseChecklist);

router.put("/:id/plan", authenticate, ctrl.updatePlan);
router.put("/:id/assessment", authenticate, ctrl.saveAssessment);

module.exports = router;
