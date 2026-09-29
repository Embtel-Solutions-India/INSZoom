const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const controller = require("../controllers/MappingGraphController");

router.use(authenticate);

router.post("/templates/:templateId/generate", authorizePermissions("forms:update"), controller.generate);
router.post("/templates/:templateId/validate", authorizePermissions("forms:read"), controller.validate);
router.get("/templates/:templateId/preview", authorizePermissions("forms:read"), controller.preview);
router.get("/templates/:templateId/autofill-preview", authorizePermissions("forms:read"), controller.autofillPreview);
router.get("/templates/:templateId/search", authorizePermissions("forms:read"), controller.search);
router.get("/templates/:templateId/versions", authorizePermissions("forms:read"), controller.versions);
router.get("/templates/:templateId/compare/:otherTemplateId", authorizePermissions("forms:read"), controller.compare);
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

module.exports = router;
