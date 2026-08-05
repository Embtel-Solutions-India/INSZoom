const User = require("../models/User");
const { verifyAccessToken } = require("../modules/auth/token.service");
const { getCachedUser, setCachedUser } = require("../config/redis");

// Like authenticate.js, but never rejects the request — for public routes
// (e.g. the eligibility quiz submit) that behave differently for a logged-in
// user without requiring login. Populates req.user when a valid Bearer token
// is present; otherwise leaves it undefined and calls next() regardless. A
// missing/expired/invalid token is silently treated as anonymous, not an error.
async function optionalAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return next();

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

    let user;
    const cached = await getCachedUser(decoded.userId);
    if (cached) {
      user = User.hydrate(cached);
    } else {
      user = await User.findById(decoded.userId).select("-password");
      if (user) setCachedUser(decoded.userId, user.toObject()).catch(() => {});
    }

    if (user && user.isActive && (user.tokenVersion || 0) === (decoded.tokenVersion || 0)) {
      req.user = user;
    }
    next();
  } catch {
    next();
  }
}

module.exports = optionalAuthenticate;
