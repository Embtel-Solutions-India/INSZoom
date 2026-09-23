const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
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
router.post(
  "/:id/form-mappings/:mappingId/provision",
  authenticate,
  authorizePermissions("forms:create"),
  ctrl.provisionMappedForm
);

// Phase 1/2 (registry-driven form visibility + on-demand USCIS fetch) - full
// paths /api/cases/:id/forms-overview and /api/cases/:id/forms/acquire.
router.get("/:id/forms-overview", authenticate, authorizePermissions("forms:read"), ctrl.getFormsOverview);
router.post(
  "/:id/forms/acquire",
  authenticate,
  authorizePermissions("forms:create"),
  [body("formNumber").trim().notEmpty().withMessage("formNumber is required")],
  validate,
  ctrl.acquireCaseForm
);

module.exports = router;
