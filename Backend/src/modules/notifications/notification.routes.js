const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const ctrl = require("./notification.controller");

const adminRoles = ["super_admin", "admin"];

router.get("/me", authenticate, authorizePermissions("notifications:read"), ctrl.getMyNotifications);
router.get("/unread-count", authenticate, authorizePermissions("notifications:read"), ctrl.getUnreadCount);
router.get("/preferences/me", authenticate, authorizePermissions("notifications:read"), ctrl.getPreferences);
router.put("/preferences/me", authenticate, authorizePermissions("notifications:update"), ctrl.updatePreferences);
router.put("/mark-all-read", authenticate, authorizePermissions("notifications:update"), ctrl.markAllAsRead);
router.put(
  "/mark-many-read",
  authenticate,
  authorizePermissions("notifications:update"),
  body("ids").isArray({ min: 1 }).withMessage("ids must be a non-empty array"),
  validate,
  ctrl.markManyAsRead
);

// Self-service device-token management (any authenticated user manages
// only their own devices — not admin-gated, same shape as /preferences/me).
router.post(
  "/register-device",
  authenticate,
  authorizePermissions("notifications:update"),
  body("token").notEmpty().withMessage("token is required"),
  validate,
  ctrl.registerDevice
);
router.delete(
  "/unregister-device",
  authenticate,
  authorizePermissions("notifications:update"),
  body("token").notEmpty().withMessage("token is required"),
  validate,
  ctrl.unregisterDevice
);
router.get("/devices", authenticate, authorizePermissions("notifications:read"), ctrl.getDevices);

router.get("/analytics/summary", authenticate, authorizeRoles(...adminRoles), authorizePermissions("notifications:read"), ctrl.getAnalytics);
router.post(
  "/events",
  authenticate,
  authorizeRoles(...adminRoles),
  authorizePermissions("notifications:create"),
  body("eventName").notEmpty().withMessage("eventName is required"),
  validate,
  ctrl.createEventNotification
);
router.post("/scheduled/process", authenticate, authorizeRoles(...adminRoles), authorizePermissions("notifications:update"), ctrl.processScheduled);
router.post("/retries/process", authenticate, authorizeRoles(...adminRoles), authorizePermissions("notifications:update"), ctrl.retryFailed);

router.get("/templates", authenticate, authorizeRoles(...adminRoles), authorizePermissions("notifications:read"), ctrl.listTemplates);
router.post(
  "/templates",
  authenticate,
  authorizeRoles(...adminRoles),
  authorizePermissions("notifications:create"),
  body("key").notEmpty().withMessage("Template key is required"),
  body("name").notEmpty().withMessage("Template name is required"),
  body("titleTemplate").notEmpty().withMessage("Title template is required"),
  body("messageTemplate").notEmpty().withMessage("Message template is required"),
  validate,
  ctrl.createTemplate
);
router.put("/templates/:id", authenticate, authorizeRoles(...adminRoles), authorizePermissions("notifications:update"), ctrl.updateTemplate);

router.get("/", authenticate, authorizePermissions("notifications:read"), ctrl.getNotifications);
router.post(
  "/",
  authenticate,
  authorizeRoles(...adminRoles),
  authorizePermissions("notifications:create"),
  body("title").notEmpty().withMessage("Title is required"),
  body("message").notEmpty().withMessage("Message is required"),
  validate,
  ctrl.createNotification
);
router.post(
  "/roles",
  authenticate,
  authorizeRoles(...adminRoles),
  authorizePermissions("notifications:create"),
  body("roles").isArray({ min: 1 }).withMessage("roles must be a non-empty array"),
  body("title").notEmpty().withMessage("Title is required"),
  body("message").notEmpty().withMessage("Message is required"),
  validate,
  ctrl.createRoleNotification
);

router.get("/:id/history", authenticate, authorizePermissions("notifications:read"), ctrl.getNotificationHistory);
router.put("/:id/read", authenticate, authorizePermissions("notifications:update"), ctrl.markAsRead);
router.put("/:id/archive", authenticate, authorizePermissions("notifications:update"), ctrl.archiveNotification);
router.put("/:id/pin", authenticate, authorizePermissions("notifications:update"), ctrl.pinNotification);
router.put("/:id/unpin", authenticate, authorizePermissions("notifications:update"), ctrl.unpinNotification);
router.put("/:id/snooze", authenticate, authorizePermissions("notifications:update"), ctrl.snoozeNotification);
router.delete("/:id", authenticate, authorizePermissions("notifications:delete"), ctrl.deleteNotification);

module.exports = router;
