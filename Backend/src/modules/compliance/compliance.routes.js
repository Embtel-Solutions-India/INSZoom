const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const authorizePermissions = require("../../middleware/authorizePermissions");
const User = require("../../models/User");
const { verifyAccessToken } = require("../auth/token.service");
const ctrl = require("./compliance.controller");

// POST /disclaimer/accept must work for BOTH anonymous public-quiz visitors
// AND signed-in portal users, so it can't require authenticate (which 401s
// with no token). This best-effort variant attaches req.user when a valid
// Bearer token is present and silently continues otherwise — a bad/expired
// token on this endpoint just means the acceptance is recorded anonymously,
// never a hard failure.
async function softAuthenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return next();
  try {
    const decoded = verifyAccessToken(authHeader.split(" ")[1]);
    const user = await User.findById(decoded.userId).select("-password");
    if (user && user.isActive && (user.tokenVersion || 0) === (decoded.tokenVersion || 0)) {
      req.user = user;
    }
  } catch {
    // Ignore — this route is public regardless of token validity.
  }
  next();
}

router.get("/disclaimer", ctrl.getDisclaimer);
router.post("/disclaimer/accept", softAuthenticate, ctrl.acceptDisclaimer);

router.post(
  "/lint",
  authenticate,
  authorizeRoles("super_admin", "admin", "team_lead", "case_manager"),
  authorizePermissions("compliance:lint"),
  ctrl.lintCopy
);

module.exports = router;
