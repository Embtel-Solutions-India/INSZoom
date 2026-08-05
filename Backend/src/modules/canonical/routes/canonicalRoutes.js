const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const controller = require("../controllers/CanonicalController");
const { validateCaseId, validateConflictResolution } = require("../validators/canonicalValidators");

router.use(authenticate);

router.get("/cases/:caseId/profile", validateCaseId, controller.getProfile);
router.post("/cases/:caseId/rebuild", validateCaseId, controller.rebuildProfile);
router.post("/cases/:caseId/validate", validateCaseId, controller.validateProfile);
router.post("/cases/:caseId/conflicts/resolve", validateCaseId, validateConflictResolution, controller.resolveConflict);
router.get("/cases/:caseId/history", validateCaseId, controller.history);
router.get("/cases/:caseId/validation", validateCaseId, controller.validation);
router.get("/cases/:caseId/validation/summary", validateCaseId, controller.validationSummary);
router.get("/cases/:caseId/conflicts", validateCaseId, controller.conflicts);
router.get("/cases/:caseId/readiness", validateCaseId, controller.readiness);
router.get("/cases/:caseId/sources", validateCaseId, controller.sources);
router.get("/cases/:caseId/missing-fields", validateCaseId, controller.missingFields);

module.exports = router;
