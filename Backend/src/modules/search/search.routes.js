const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./search.controller");

router.get("/", authenticate, authorizePermissions("search:read"), ctrl.globalSearch);
router.post("/natural-language", authenticate, authorizePermissions("search:read"), ctrl.naturalLanguageSearch);
router.get("/autocomplete", authenticate, authorizePermissions("search:read"), ctrl.autocomplete);
router.get("/suggestions", authenticate, authorizePermissions("search:read"), ctrl.suggestions);
router.get("/history", authenticate, authorizePermissions("search:read"), ctrl.history);
router.get("/saved", authenticate, authorizePermissions("search:read"), ctrl.saved);
router.post("/saved", authenticate, authorizePermissions("search:create"), ctrl.createSaved);
router.put("/saved/:id", authenticate, authorizePermissions("search:update"), ctrl.updateSaved);
router.delete("/saved/:id", authenticate, authorizePermissions("search:delete"), ctrl.deleteSaved);
router.post("/saved/:id/run", authenticate, authorizePermissions("search:read"), ctrl.runSaved);

module.exports = router;
