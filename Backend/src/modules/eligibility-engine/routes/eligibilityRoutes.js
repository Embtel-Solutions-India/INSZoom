const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const controller = require("../controllers/EligibilityController");

router.use(authenticate);

router.post("/evaluate", authorizePermissions("cases:read"), controller.evaluate);
router.get("/:caseId/results", authorizePermissions("cases:read"), controller.results);
router.get("/:caseId/gaps", authorizePermissions("cases:read"), controller.gaps);
router.get("/:caseId/recommendations", authorizePermissions("cases:read"), controller.recommendations);
router.post("/:caseId/recalculate", authorizePermissions("cases:update"), controller.recalculate);
router.post("/:caseId/override", authorizeRoles("super_admin", "admin", "attorney"), authorizePermissions("cases:update"), controller.override);

module.exports = router;
