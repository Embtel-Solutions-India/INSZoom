const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const ctrl = require("./quizAdmin.controller");

router.use(authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("eligibility_quiz:admin"));

router.get("/scoring-config", ctrl.listScoringConfigs);
router.post("/scoring-config", ctrl.createScoringConfig);
router.put("/scoring-config/:id", ctrl.updateScoringConfig);
router.post("/scoring-config/:id/activate", ctrl.activateScoringConfig);

router.get("/quiz-definition", ctrl.listQuizDefinitions);
router.post("/quiz-definition", ctrl.createQuizDefinition);
router.put("/quiz-definition/:id", ctrl.updateQuizDefinition);
router.post("/quiz-definition/:id/activate", ctrl.activateQuizDefinition);

module.exports = router;
