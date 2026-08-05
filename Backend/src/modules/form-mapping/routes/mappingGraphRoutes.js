const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const controller = require("../controllers/MappingGraphController");

router.use(authenticate);

router.post("/templates/:templateId/generate", authorizePermissions("forms:update"), controller.generate);
router.post("/templates/:templateId/validate", authorizePermissions("forms:read"), controller.validate);
router.get("/templates/:templateId/preview", authorizePermissions("forms:read"), controller.preview);
router.get("/templates/:templateId/search", authorizePermissions("forms:read"), controller.search);
router.get("/templates/:templateId/versions", authorizePermissions("forms:read"), controller.versions);
router.get("/templates/:templateId/compare/:otherTemplateId", authorizePermissions("forms:read"), controller.compare);
router.post("/templates/:templateId/activate", authorizePermissions("forms:update"), controller.activate);
router.put("/templates/:templateId/mappings/:targetFieldId", authorizePermissions("forms:update"), (req, res, next) => {
  req.body = { ...(req.body || {}), targetFieldId: req.params.targetFieldId };
  return controller.upsertMapping(req, res, next);
});
router.delete("/templates/:templateId/mappings/:mappingId", authorizePermissions("forms:update"), controller.deleteMapping);

module.exports = router;
