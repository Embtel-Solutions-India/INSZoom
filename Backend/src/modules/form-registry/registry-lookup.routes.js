const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const ctrl = require("./form-registry.controller");

// Mounted at /api/form-registry - full path GET /api/form-registry/visa/:visaType
router.get("/visa/:visaType", authenticate, ctrl.getMappingsForVisa);

module.exports = router;
