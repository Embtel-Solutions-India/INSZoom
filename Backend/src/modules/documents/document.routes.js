const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const upload = require("../uploads/upload.middleware");
const ctrl = require("./document.controller");

const allDocumentRoles = ["super_admin", "admin", "team_lead", "case_manager", "client", "user", "employer", "employee"];
const staffRoles = ["super_admin", "admin", "team_lead", "case_manager"];
const reviewRoles = ["super_admin", "admin", "team_lead", "case_manager"];

router.get("/me", authenticate, ctrl.getMyDocuments);
router.post("/me", authenticate, upload.single("file"), ctrl.uploadDocument);
router.get("/user/:userId", authenticate, authorizeRoles("super_admin", "admin"), ctrl.getUserDocuments);
router.post("/user/:userId", authenticate, authorizeRoles("super_admin", "admin"), upload.single("file"), ctrl.uploadDocument);

router.get("/folders", authenticate, authorizeRoles(...allDocumentRoles), authorizePermissions("documents:read"), ctrl.getFolders);
router.get("/missing", authenticate, authorizeRoles(...allDocumentRoles), authorizePermissions("documents:read"), ctrl.getMissingDocuments);
router.get("/evidence/cases/:caseId", authenticate, authorizeRoles(...allDocumentRoles), authorizePermissions("documents:read"), ctrl.getCaseEvidence);
router.post("/requests", authenticate, authorizeRoles(...staffRoles), authorizePermissions("documents:create"), ctrl.requestDocument);
router.post("/bulk-upload", authenticate, authorizePermissions("documents:create"), upload.array("files", 25), ctrl.bulkUpload);
router.post("/bulk-download", authenticate, authorizePermissions("documents:read"), ctrl.bulkDownload);
router.post("/bulk", authenticate, authorizeRoles(...staffRoles), authorizePermissions("documents:update"), ctrl.bulkActions);
router.post(
  "/uploads/sessions",
  authenticate,
  authorizePermissions("documents:create"),
  body("originalName").isString().trim().notEmpty(),
  body("mimeType").isString().trim().notEmpty(),
  body("expectedSize").isInt({ min: 1 }),
  body("caseId").optional().isMongoId(),
  validate,
  ctrl.createUploadSession
);
router.get("/uploads/sessions/:uploadId", authenticate, authorizePermissions("documents:create"), ctrl.getUploadSession);
router.put("/uploads/sessions/:uploadId/chunks/:chunkIndex", authenticate, authorizePermissions("documents:create"), upload.single("chunk"), ctrl.uploadChunk);
router.post("/uploads/sessions/:uploadId/complete", authenticate, authorizePermissions("documents:create"), ctrl.completeUploadSession);
router.delete("/uploads/sessions/:uploadId", authenticate, authorizePermissions("documents:create"), ctrl.cancelUploadSession);

router.post(
  "/upload",
  authenticate,
  authorizePermissions("documents:create"),
  upload.single("file"),
  body("documentType").optional().isString(),
  body("category").optional().isString(),
  validate,
  ctrl.createDocument
);
router.get("/", authenticate, authorizeRoles(...allDocumentRoles), authorizePermissions("documents:read"), ctrl.getDocuments);
router.post(
  "/",
  authenticate,
  authorizePermissions("documents:create"),
  upload.single("file"),
  body("documentType").optional().isString(),
  body("category").optional().isString(),
  validate,
  ctrl.createDocument
);

router.get("/:id/versions", authenticate, authorizePermissions("documents:read"), ctrl.getDocumentVersions);
router.post("/:id/restore", authenticate, authorizeRoles(...staffRoles), authorizePermissions("documents:update"), ctrl.restoreDocument);
router.post("/:id/versions", authenticate, upload.single("file"), ctrl.addVersion);
router.post("/:id/versions/:version/restore", authenticate, authorizeRoles(...staffRoles), authorizePermissions("documents:update"), ctrl.restoreVersion);
router.post("/:id/evidence", authenticate, authorizeRoles(...reviewRoles), authorizePermissions("documents:review"), ctrl.linkEvidence);
router.post("/:id/evidence/classify", authenticate, authorizeRoles(...reviewRoles), authorizePermissions("documents:review"), ctrl.classifyEvidence);
router.post("/:id/comments", authenticate, authorizeRoles(...reviewRoles), authorizePermissions("documents:review"), ctrl.addReviewComment);
router.get("/:id/download", authenticate, authorizePermissions("documents:read"), ctrl.downloadDocument);
router.get("/:id/preview", authenticate, authorizePermissions("documents:read"), ctrl.previewDocument);
router.post("/:id/share", authenticate, authorizeRoles(...staffRoles), authorizePermissions("documents:update"), ctrl.shareDocument);
router.put("/:id/signature", authenticate, authorizeRoles(...staffRoles), authorizePermissions("documents:update"), ctrl.updateSignature);
router.get("/:id", authenticate, authorizeRoles(...allDocumentRoles), authorizePermissions("documents:read"), ctrl.getDocument);
router.put("/:id", authenticate, authorizeRoles(...staffRoles), authorizePermissions("documents:update"), ctrl.updateDocument);
router.put("/:id/review", authenticate, authorizeRoles(...reviewRoles), authorizePermissions("documents:review"), ctrl.reviewDocument);
router.delete("/:id", authenticate, ctrl.deleteDocument);

module.exports = router;
