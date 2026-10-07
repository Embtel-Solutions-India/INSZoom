const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const ctrl = require("./form-registry.controller");

// Mounted at /api/form-registry - full path GET /api/form-registry/visa/:visaType
router.get("/visa/:visaType", authenticate, ctrl.getMappingsForVisa);

// Form Governance page - GET /api/form-registry/catalog, POST
// /api/form-registry/catalog/:formCode/fetch. Catalog read is forms:read
// (same tier as the rest of the forms surface); the live uscis.gov fetch is
// restricted the same way template Approve/Activate already are, since it
// creates/updates a real USCISFormTemplate record.
router.get("/catalog", authenticate, authorizePermissions("forms:read"), ctrl.getFormCatalog);
router.post("/catalog/:formCode/fetch", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:approve"), ctrl.fetchFormFromUSCIS);
router.delete("/catalog/:formCode", authenticate, authorizeRoles("super_admin", "admin"), authorizePermissions("forms:delete"), ctrl.deleteFormFromCatalog);

module.exports = router;
