const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const requireAttorneyAccess = require("../../middleware/requireAttorneyAccess");
const validate = require("../../middleware/validate");
const upload = require("../uploads/upload.middleware");
const ctrl = require("./attorney.controller");

// Every route here is attorney-only (authorizeRoles) AND, for anything
// case-scoped, grant-checked against that specific case
// (requireAttorneyAccess). Neither check is sufficient alone: the first
// stops non-attorneys, the second stops an attorney reaching a case nobody
// granted them.
const requireAttorney = authorizeRoles("attorney");

router.get("/cases", authenticate, requireAttorney, authorizePermissions("cases:read"), ctrl.listCases);
router.get("/dashboard", authenticate, requireAttorney, authorizePermissions("dashboard:read"), ctrl.getDashboard);

router.get("/cases/:caseId", authenticate, requireAttorney, authorizePermissions("cases:read"), requireAttorneyAccess, ctrl.getCase);

router.get(
  "/cases/:caseId/feedback",
  authenticate,
  requireAttorney,
  authorizePermissions("feedback:read"),
  requireAttorneyAccess,
  ctrl.listFeedback
);
router.post(
  "/cases/:caseId/feedback",
  authenticate,
  requireAttorney,
  authorizePermissions("feedback:create"),
  requireAttorneyAccess,
  upload.array("attachments", 5),
  body("message").optional().isString(),
  validate,
  ctrl.createFeedback
);
router.post(
  "/cases/:caseId/feedback/:feedbackId/reply",
  authenticate,
  requireAttorney,
  authorizePermissions("feedback:create"),
  requireAttorneyAccess,
  upload.array("attachments", 5),
  body("message").optional().isString(),
  validate,
  ctrl.replyToFeedback
);
router.patch(
  "/cases/:caseId/feedback/mark-read",
  authenticate,
  requireAttorney,
  authorizePermissions("feedback:update"),
  requireAttorneyAccess,
  ctrl.markFeedbackRead
);
router.get(
  "/cases/:caseId/feedback/:feedbackId/attachments/:attachmentId",
  authenticate,
  requireAttorney,
  authorizePermissions("feedback:read"),
  requireAttorneyAccess,
  ctrl.getFeedbackAttachment
);

module.exports = router;
