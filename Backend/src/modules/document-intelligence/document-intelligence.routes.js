const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const upload = require("../uploads/upload.middleware");
const ctrl = require("./controllers/document-intelligence.controller");
// Provider registration lives in document-intelligence.service.js, not here —
// that module (not this routes file) is the actual common dependency of
// every path that resolves the registry: the HTTP controller above, AND the
// async queue processor (processors/document-intelligence.processor.js),
// which requires the service directly and never touches this routes file.

const readerRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const uploadRoles = ["super_admin", "admin", "team_lead", "case_manager", "client", "user"];
const processorRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const reviewerRoles = ["super_admin", "admin", "team_lead", "case_manager"];
// Case participants (employer/employee/client) can view and confirm prefill
// suggestions on their own case; access is further scoped by canAccessCase().
const casePrefillRoles = ["super_admin", "admin", "team_lead", "case_manager", "employer", "employee", "client"];

router.get("/dashboard", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:read"), ctrl.dashboard);
router.get("/review-queue", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:review"), ctrl.reviewQueue);
router.get("/analyses", authenticate, authorizeRoles(...readerRoles), authorizePermissions("document_intelligence:read"), ctrl.listAnalyses);
router.get("/analyses/review-queue", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:review"), ctrl.analysisReviewQueue);
router.get("/analyses/:id", authenticate, authorizeRoles(...readerRoles), authorizePermissions("document_intelligence:read"), ctrl.getAnalysis);
router.post("/analyses/:id/approve", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:review"), ctrl.approveAnalysis);
router.post("/analyses/:id/reject", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:review"), ctrl.rejectAnalysis);
router.put("/analyses/:id", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:review"), ctrl.editAnalysis);
router.post("/analyses/:id/reprocess", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:update"), ctrl.reprocessAnalysis);
router.get("/evidence-categories", authenticate, authorizeRoles(...readerRoles), authorizePermissions("document_intelligence:read"), ctrl.evidenceCategories);
router.post("/upload", authenticate, authorizeRoles(...uploadRoles), authorizePermissions("document_intelligence:create"), upload.single("file"), ctrl.uploadDocument);
// Case-participant-triggered "upload one file, extract now" — used by the client-portal
// questionnaire's Autofill button. Scoped to document types with a real field mapping
// (see config/autofill-document-types.js) and gated by case ownership in the controller.
router.post("/autofill", authenticate, authorizeRoles(...casePrefillRoles), authorizePermissions("document_intelligence:create"), upload.single("file"), ctrl.autofillQuestionnaire);
router.post("/case/:caseId/autofill", authenticate, authorizeRoles(...casePrefillRoles), authorizePermissions("document_intelligence:create"), upload.single("file"), ctrl.autofillQuestionnaire);
router.post("/documents/:documentId/classify", authenticate, authorizeRoles(...processorRoles), authorizePermissions("document_intelligence:create"), ctrl.classifyDocument);
router.post("/documents/:documentId/extract", authenticate, authorizeRoles(...processorRoles), authorizePermissions("document_intelligence:create"), ctrl.extractDocument);
router.get("/documents/:documentId", authenticate, authorizeRoles(...readerRoles), authorizePermissions("document_intelligence:read"), ctrl.getExtractionByDocument);
router.get("/", authenticate, authorizeRoles(...readerRoles), authorizePermissions("document_intelligence:read"), ctrl.listExtractions);
router.get("/:id", authenticate, authorizeRoles(...readerRoles), authorizePermissions("document_intelligence:read"), ctrl.getExtraction);
router.get("/:id/confidence", authenticate, authorizeRoles(...readerRoles), authorizePermissions("document_intelligence:read"), ctrl.confidenceScores);
router.get("/:id/questionnaire-prefill", authenticate, authorizeRoles(...readerRoles), authorizePermissions("document_intelligence:read"), ctrl.questionnairePrefill);
router.post("/:id/approve", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:review"), ctrl.approveExtraction);
router.post("/:id/reject", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:review"), ctrl.rejectExtraction);
router.put("/:id/field", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:review"), ctrl.editField);
router.put("/:id/classification", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:review"), ctrl.overrideClassification);
router.post("/:id/reprocess", authenticate, authorizeRoles(...reviewerRoles), authorizePermissions("document_intelligence:update"), ctrl.reprocessExtraction);

router.get("/case/:caseId/prefill-summary", authenticate, authorizeRoles(...casePrefillRoles), ctrl.casePrefillSummary);
router.post("/case/:caseId/masterdata-field/:prefillId/:action", authenticate, authorizeRoles(...casePrefillRoles), ctrl.reviewMasterDataField);

module.exports = router;
