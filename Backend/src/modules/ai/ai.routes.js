const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const authorizeRoles = require("../../middleware/authorizeRoles");
const validate = require("../../middleware/validate");
const controller = require("./ai.controller");

const aiRoles = ["super_admin", "admin", "team_lead", "case_manager", "client", "user"];
const professionalRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const approvingRoles = ["super_admin", "admin", "team_lead", "case_manager"];

router.use(authenticate);
router.post(
  "/cases/:caseId/copilot",
  authorizeRoles(...aiRoles),
  authorizePermissions("ai:create"),
  body("question").isString().trim().notEmpty().isLength({ max: 5000 }),
  body("background").optional().isBoolean(),
  validate,
  controller.copilot
);
router.post("/cases/:caseId/review", authorizeRoles(...professionalRoles), authorizePermissions("ai:review"), controller.caseReview);
router.post("/cases/:caseId/task-suggestions", authorizeRoles(...professionalRoles), authorizePermissions("ai:create"), controller.taskSuggestions);
router.post(
  "/search",
  authorizeRoles(...aiRoles),
  authorizePermissions("ai:read"),
  body("question").isString().trim().notEmpty().isLength({ max: 1000 }),
  validate,
  controller.semanticSearch
);
router.get("/jobs", authorizeRoles(...aiRoles), authorizePermissions("ai:read"), controller.listJobs);
router.put(
  "/jobs/:id/review",
  authorizeRoles(...professionalRoles),
  authorizePermissions("ai:review"),
  body("status").isIn(["approved", "partially_approved", "rejected"]),
  validate,
  controller.reviewJob
);
router.post(
  "/jobs/:id/apply-tasks",
  authorizeRoles(...approvingRoles),
  authorizePermissions("ai:review"),
  body("approvedSuggestionIndexes").isArray(),
  validate,
  controller.applyTasks
);

router.get("/providers", authorizeRoles("super_admin", "admin"), authorizePermissions("ai:update"), controller.providers);
router.put(
  "/providers/:key",
  authorizeRoles("super_admin", "admin"),
  authorizePermissions("ai:update"),
  body("provider").optional().isIn(["gemini", "openai", "anthropic", "azure_openai", "self_hosted"]),
  body("apiKeyEnv").optional().matches(/^[A-Z][A-Z0-9_]+$/),
  validate,
  controller.updateProvider
);
router.get("/prompts", authorizeRoles("super_admin", "admin"), authorizePermissions("ai:update"), controller.prompts);
router.post(
  "/prompts",
  authorizeRoles("super_admin", "admin"),
  authorizePermissions("ai:update"),
  body("key").isString().trim().notEmpty(),
  body("name").isString().trim().notEmpty(),
  body("purpose").isString().trim().notEmpty(),
  body("systemPrompt").isString().trim().notEmpty(),
  body("userPrompt").isString().trim().notEmpty(),
  validate,
  controller.createPrompt
);
router.put("/prompts/:id", authorizeRoles("super_admin", "admin"), authorizePermissions("ai:update"), controller.updatePrompt);
router.get("/usage", authorizeRoles("super_admin", "admin"), authorizePermissions("ai:update"), controller.usage);

module.exports = router;
