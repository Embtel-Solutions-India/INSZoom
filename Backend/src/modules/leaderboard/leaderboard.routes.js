const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const ctrl = require("./leaderboard.controller");

router.get("/", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), ctrl.list);
router.post("/calculate", authenticate, authorizeRoles("super_admin", "admin", "team_lead"), ctrl.calculate);

module.exports = router;
