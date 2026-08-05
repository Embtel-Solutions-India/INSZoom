const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./routing.controller");

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/options", publicLimiter, ctrl.getOptions);
router.post("/book", publicLimiter, ctrl.book);

router.get("/queue", authenticate, authorizeRoles("super_admin", "admin", "case_manager", "team_lead"), authorizePermissions("consultation_routing:read"), ctrl.listQueue);
router.post("/queue/:id/claim", authenticate, authorizeRoles("super_admin", "admin", "case_manager", "team_lead"), authorizePermissions("consultation_routing:update"), ctrl.claim);

module.exports = router;
