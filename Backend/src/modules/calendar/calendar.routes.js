const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./calendar.controller");

const calendarRoles = ["super_admin", "admin", "case_manager", "team_lead", "client", "user"];
const managerRoles = ["super_admin", "admin", "case_manager", "team_lead"];

router.get("/", authenticate, authorizeRoles(...calendarRoles), authorizePermissions("calendar:read"), ctrl.getCalendar);
router.get("/events", authenticate, authorizeRoles(...calendarRoles), authorizePermissions("calendar:read"), ctrl.getEvents);
router.post(
  "/events",
  authenticate,
  authorizeRoles(...managerRoles),
  authorizePermissions("calendar:create"),
  body("title").notEmpty().withMessage("title is required"),
  body("startAt").isISO8601().withMessage("startAt must be a valid date"),
  body("endAt").isISO8601().withMessage("endAt must be a valid date"),
  validate,
  ctrl.createEvent
);
router.put("/events/:id", authenticate, authorizeRoles(...managerRoles), authorizePermissions("calendar:update"), ctrl.updateEvent);

router.get("/availability", authenticate, authorizeRoles(...calendarRoles), authorizePermissions("calendar:read"), ctrl.getAvailability);
router.put("/availability/me", authenticate, authorizePermissions("calendar:update"), ctrl.upsertAvailability);
router.put("/availability/:userId", authenticate, authorizeRoles(...managerRoles), authorizePermissions("calendar:update"), ctrl.upsertAvailability);

router.get("/resources", authenticate, authorizeRoles(...calendarRoles), authorizePermissions("calendar:read"), ctrl.listResources);
router.post(
  "/resources",
  authenticate,
  authorizeRoles(...managerRoles),
  authorizePermissions("calendar:manage_resources"),
  body("name").notEmpty().withMessage("name is required"),
  validate,
  ctrl.createResource
);
router.put("/resources/:id", authenticate, authorizeRoles(...managerRoles), authorizePermissions("calendar:manage_resources"), ctrl.updateResource);

router.get("/integrations", authenticate, authorizeRoles(...calendarRoles), authorizePermissions("calendar:read"), ctrl.listIntegrations);
router.put(
  "/integrations",
  authenticate,
  authorizeRoles(...calendarRoles),
  authorizePermissions("calendar:sync"),
  body("provider").isIn(["google", "outlook", "zoom", "teams"]).withMessage("provider must be google, outlook, zoom or teams"),
  validate,
  ctrl.upsertIntegration
);
router.post("/sync/:provider", authenticate, authorizeRoles(...calendarRoles), authorizePermissions("calendar:sync"), ctrl.syncProvider);
router.get("/suggestions", authenticate, authorizeRoles(...calendarRoles), authorizePermissions("calendar:read"), ctrl.suggestSlots);

module.exports = router;
