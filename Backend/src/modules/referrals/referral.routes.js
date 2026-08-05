const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const ctrl = require("./referral.controller");

router.get("/me", authenticate, ctrl.getMyReferral);
router.get("/validate/:code", authenticate, ctrl.validateCode);

module.exports = router;
