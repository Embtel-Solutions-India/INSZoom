const router = require("express").Router();
const { param } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const service = require("./recycle-bin.service");

// Deleted cases held for 30 days. Admins and super admins see the bin, restore from it and can remove an item for good before its time.
const validId = [param("id").isMongoId().withMessage("Valid recycle bin item ID is required"), validate];
const wrap = (handler) => async (req, res, next) => {
  try {
    await handler(req, res);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ success: false, code: error.code, message: error.message });
    next(error);
  }
};

router.get("/", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("cases:delete"), wrap(async (req, res) => {
  res.json({ success: true, retentionDays: service.RETENTION_DAYS, items: await service.listEntries() });
}));

router.post("/:id/restore", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("cases:delete"), ...validId, wrap(async (req, res) => {
  const result = await service.restoreEntry(req.params.id, req.user);
  res.json({ success: true, message: `Restored ${result.caseNumbers.join(", ")}.`, ...result });
}));

router.delete("/:id", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("cases:delete"), ...validId, wrap(async (req, res) => {
  const result = await service.purgeNow(req.params.id, req.user);
  res.json({ success: true, message: `${result.caseNumbers.join(", ")} permanently deleted.` });
}));

module.exports = router;
