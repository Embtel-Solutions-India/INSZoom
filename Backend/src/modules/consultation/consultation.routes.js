const router = require("express").Router();
const rateLimit = require("express-rate-limit");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./consultation.controller");

const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get("/config", publicLimiter, ctrl.getConfig);
router.get("/slots", publicLimiter, ctrl.getSlots);
router.post("/book", publicLimiter, ctrl.book);
router.get("/booking/:token", publicLimiter, ctrl.getBooking);
router.post("/booking/:token/reschedule", publicLimiter, ctrl.rescheduleBooking);
router.post("/booking/:token/cancel", publicLimiter, ctrl.cancelBooking);

router.get("/admin/availability", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("consultation_routing:read"), ctrl.getAdminAvailability);
router.put("/admin/availability", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("consultation_routing:update"), ctrl.setAdminAvailability);

module.exports = router;
