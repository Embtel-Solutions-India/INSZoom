const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const ctrl = require("./team-management.controller");

router.use(authenticate);
router.use(authorizeRoles("super_admin", "admin", "team_lead")); // 403 for case_manager and below

router.get("/", ctrl.list);
router.post("/", ctrl.create);
router.patch("/:id", ctrl.update);
router.delete("/:id", ctrl.remove);

module.exports = router;
