const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const controller = require("../controllers/MappingGraphController");
const readinessController = require("../controllers/FormReadinessController");

router.use(authenticate);

router.post("/templates/:templateId/generate", authorizePermissions("forms:update"), controller.generate);
router.post("/templates/:templateId/validate", authorizePermissions("forms:read"), controller.validate);
router.get("/templates/:templateId/preview", authorizePermissions("forms:read"), controller.preview);
router.get("/templates/:templateId/autofill-preview", authorizePermissions("forms:read"), controller.autofillPreview);
router.get("/templates/:templateId/search", authorizePermissions("forms:read"), controller.search);
router.get("/templates/:templateId/versions", authorizePermissions("forms:read"), controller.versions);
router.get("/templates/:templateId/compare/:otherTemplateId", authorizePermissions("forms:read"), controller.compare);
// Edition-change governance (Phase 3J) - read-only preview of what changed
// versus the previous edition (formFields diff + which live mapping edges/
// checklist traces it broke), and the human-review acknowledgement step
// that unblocks MappingGraphService.activate()'s additive edition-change
// gate. Never activates anything itself.
router.get("/templates/:templateId/edition-diff", authorizePermissions("forms:read"), controller.editionDiff);
router.post("/templates/:templateId/edition-diff/acknowledge", authorizePermissions("forms:update"), controller.acknowledgeEditionDiff);
router.post("/templates/:templateId/activate", authorizePermissions("forms:update"), controller.activate);
router.put("/templates/:templateId/mappings/:targetFieldId", authorizePermissions("forms:update"), (req, res, next) => {
  req.body = { ...(req.body || {}), targetFieldId: req.params.targetFieldId };
  return controller.upsertMapping(req, res, next);
});
router.delete("/templates/:templateId/mappings/:mappingId", authorizePermissions("forms:update"), controller.deleteMapping);

// Checklist <-> field traceability (read-only governance queries).
router.get("/templates/:templateId/checklist-trace/field/:targetFieldId", authorizePermissions("forms:read"), controller.traceFieldToQuestions);
router.get("/templates/:templateId/checklist-trace/questionnaire/:questionnaireKey", authorizePermissions("forms:read"), controller.traceQuestionsToFields);
router.get("/templates/:templateId/checklist-trace/coverage", authorizePermissions("forms:read"), controller.checklistTraceCoverage);
router.get("/templates/:templateId/checklist-trace/fields", authorizePermissions("forms:read"), controller.traceAllFieldsForTemplate);
router.get("/checklist-trace/coverage", authorizePermissions("forms:read"), controller.checklistTraceCoverageAll);

// Phase 3H/3I governance additions - read-only, same forms:read gate as
// every other checklist-trace endpoint above.
router.get("/templates/:templateId/checklist-trace/defects", authorizePermissions("forms:read"), controller.governanceDefects);
router.get("/checklist-health", authorizePermissions("forms:read"), controller.checklistHealth);

// CaseForm readiness diagnostics (Phase 3E/3F) - read-only, case-access
// gated (see FormReadinessController.assertCaseFormAccess) in addition to
// the forms:read permission every other read here already requires.
router.get("/case-forms/:caseFormId/readiness", authorizePermissions("forms:read"), readinessController.readiness);
router.get("/case-forms/:caseFormId/readiness/fields/:targetFieldId/trace", authorizePermissions("forms:read"), readinessController.traceMissingField);

module.exports = router;
