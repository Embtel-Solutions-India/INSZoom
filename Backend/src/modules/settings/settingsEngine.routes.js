const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const requireSettingPermission = require("../../middleware/requireSettingPermission");
const ctrl = require("./settingsEngine.controller");

// Mounted at /api/settings-v2 (see routes/index.js) — deliberately a
// separate path from the original /api/settings whole-document CRUD
// (modules/settings/settings.controller.js), which stays untouched so
// nothing currently depending on it breaks. This is the new engine's
// surface; the Admin Settings UI is the only intended caller.
router.get("/catalog", authenticate, requireSettingPermission("settings:view"), ctrl.getCatalog);
router.get("/audit", authenticate, requireSettingPermission("settings:audit_view"), ctrl.listAudit);
router.get("/:key/history", authenticate, requireSettingPermission("settings:view"), ctrl.getHistory);
router.post("/:key/rollback", authenticate, requireSettingPermission("settings:view"), ctrl.rollback);
router.get("/:key", authenticate, requireSettingPermission("settings:view"), ctrl.getOne);
router.patch("/", authenticate, requireSettingPermission("settings:view"), ctrl.bulkSet);

module.exports = router;
