const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./entityConfig.controller");

// Public — brand tokens + entity display names + resolved disclaimer. Must
// be reachable with no auth: the public quiz/marketing surfaces (Phase A)
// render this before a visitor ever creates an account.
router.get("/public", ctrl.getPublicConfig);

// Authenticated, any role — the canonical status vocabulary is a read-only
// reference map every portal needs to render statuses consistently.
router.get("/status-vocabulary", authenticate, ctrl.getStatusVocabulary);

router.get("/", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("entity_config:read"), ctrl.getConfig);
router.patch("/", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("entity_config:update"), ctrl.updateConfig);

module.exports = router;
