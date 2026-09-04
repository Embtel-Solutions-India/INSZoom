const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const validate = require("../../middleware/validate");
const ctrl = require("./form-registry.controller");

// Case-scoped routes - mounted under /api/cases (see routes/index.js), so
// full paths are /api/cases/:id/form-mappings and /api/cases/:id/form-
// mappings/conditional and /api/cases/:id/form-mappings/:mappingId/decision.
router.get("/:id/form-mappings", authenticate, ctrl.getCaseFormMappings);
router.get("/:id/form-mappings/conditional", authenticate, ctrl.getConditionalFormMappings);
router.post(
  "/:id/form-mappings/:mappingId/decision",
  authenticate,
  [body("decision").isIn(["ADD", "NOT_APPLICABLE"]).withMessage("decision must be ADD or NOT_APPLICABLE"), body("reason").optional().trim()],
  validate,
  ctrl.decideConditionalFormMapping
);

module.exports = router;
