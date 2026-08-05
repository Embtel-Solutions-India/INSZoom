const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const upload = require("../uploads/upload.middleware");
const ctrl = require("./message.controller");

const messageRoles = ["super_admin", "admin", "team_lead", "case_manager", "client", "user", "employer", "employee"];

router.get("/case/:caseId", authenticate, authorizePermissions("messages:read"), ctrl.getOrCreateThread);
router.get("/unread-count", authenticate, authorizePermissions("messages:read"), ctrl.getUnreadCount);
router.get("/search", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:read"), ctrl.searchMessages);
router.get("/analytics/summary", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:read"), ctrl.getAnalytics);
router.get("/templates", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:read"), ctrl.getTemplates);
router.post("/templates", authenticate, authorizeRoles("super_admin", "admin", "team_lead", "case_manager"), authorizePermissions("messages:create"), ctrl.createTemplate);
router.post("/templates/:id/render", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:read"), ctrl.renderTemplate);
router.put("/conversations/:id", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:update"), ctrl.updateConversation);
router.post("/conversations/:id/typing", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:update"), ctrl.typing);
router.get("/conversations/:id/smart-replies", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:read"), ctrl.getSmartReplies);
router.get("/", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:read"), ctrl.getThreads);
router.post(
  "/",
  authenticate,
  authorizeRoles(...messageRoles),
  authorizePermissions("messages:create"),
  upload.array("attachments", 5),
  body("message").optional().isString(),
  body("messageBody").optional().isString(),
  validate,
  ctrl.createMessage
);

router.get("/:messageId/attachments/:attachmentId", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:read"), ctrl.getAttachment);
router.put("/:id/read", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:update"), ctrl.markMessageAsRead);
router.put("/:id", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:update"), ctrl.editMessage);
router.post("/:id/reactions", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:update"), ctrl.reactToMessage);
router.post("/:id/translate", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:read"), ctrl.translateMessage);
router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("messages:delete"), ctrl.deleteMessage);
router.get("/:threadId", authenticate, authorizeRoles(...messageRoles), authorizePermissions("messages:read"), ctrl.getMessages);
router.post(
  "/:threadId",
  authenticate,
  authorizeRoles(...messageRoles),
  authorizePermissions("messages:create"),
  upload.array("attachments", 5),
  ctrl.sendThreadMessage
);

module.exports = router;
