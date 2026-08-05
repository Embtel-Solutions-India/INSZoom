const multer = require("multer");
const router = require("express").Router();
const authenticate = require("../../../middleware/authenticate");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const authorizePermissions = require("../../../middleware/authorizePermissions");
const controller = require("../controllers/USCISFormImportController");
const { normalizeImportBody, validateSystemImport } = require("../validators/uscisFormImportValidators");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.USCIS_FORM_IMPORT_MAX_BYTES || 50 * 1024 * 1024),
    files: 1,
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype && !/pdf|octet-stream/i.test(file.mimetype)) return cb(new Error("Only PDF files can be imported"));
    return cb(null, true);
  },
});

router.use(authenticate);

router.get("/", authorizePermissions("forms:read"), controller.list);
router.get("/:id", authorizePermissions("forms:read"), controller.get);
router.get("/:id/fields", authorizePermissions("forms:read"), controller.fields);
router.get("/:id/fields/search", authorizePermissions("forms:read"), controller.searchFields);
router.get("/:id/fields/:fieldId", authorizePermissions("forms:read"), controller.fieldMetadata);
router.get("/:id/sections", authorizePermissions("forms:read"), controller.sections);
router.get("/:id/layout", authorizePermissions("forms:read"), controller.layout);
router.get("/:id/dependencies", authorizePermissions("forms:read"), controller.dependencies);
router.get("/:id/validation", authorizePermissions("forms:read"), controller.validationRules);
router.get("/:id/compare", authorizePermissions("forms:read"), controller.compare);

router.post("/import", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:create"), normalizeImportBody, validateSystemImport, controller.importFromUrl);
router.post("/upload", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:create"), upload.single("pdf"), normalizeImportBody, controller.upload);
router.post("/:id/activate", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), controller.activate);
router.post("/:id/retire", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:update"), controller.retire);
router.delete("/:id/draft", authorizeRoles("super_admin", "admin"), authorizePermissions("forms:delete"), controller.deleteDraft);

module.exports = router;
