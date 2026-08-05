const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./dataRights.controller");

router.use(authenticate);

router.post("/requests", authorizeRoles("client", "admin", "super_admin"), authorizePermissions("data_rights:create"), ctrl.createRequest);
router.get("/requests", authorizeRoles("super_admin", "admin"), authorizePermissions("data_rights:read"), ctrl.listRequests);
router.post("/requests/:id/approve", authorizeRoles("super_admin", "admin"), authorizePermissions("data_rights:approve"), ctrl.approve);
router.post("/requests/:id/reject", authorizeRoles("super_admin", "admin"), authorizePermissions("data_rights:reject"), ctrl.reject);
// Any authenticated role may hit this — ownership (subject or staff) is
// enforced inside dataRights.service.getExportArtifact, not by role alone.
router.get("/requests/:id/export", ctrl.downloadExport);

module.exports = router;
