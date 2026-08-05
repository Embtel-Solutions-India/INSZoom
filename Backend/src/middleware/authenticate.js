const User = require("../models/User");
const { verifyAccessToken } = require("../modules/auth/token.service");
const { getCachedUser, setCachedUser } = require("../config/redis");

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ success: false, message: "Access token required" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = verifyAccessToken(token);

    // Cache-aside: a hit rehydrates a real Mongoose document (same methods,
    // virtuals, and .save() behavior as a fresh findById) so nothing
    // downstream can tell the difference. Invalidated wherever isActive /
    // tokenVersion / profile fields change — see config/redis.js callers.
    let user;
    const cached = await getCachedUser(decoded.userId);
    if (cached) {
      user = User.hydrate(cached);
    } else {
      user = await User.findById(decoded.userId).select("-password");
      if (user) setCachedUser(decoded.userId, user.toObject()).catch(() => {});
    }

    if (!user || !user.isActive || (user.tokenVersion || 0) !== (decoded.tokenVersion || 0)) {
      return res.status(401).json({ success: false, message: "User not found or deactivated" });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ success: false, message: "Access token expired", code: "TOKEN_EXPIRED" });
    }
    return res.status(401).json({ success: false, message: "Invalid access token" });
  }
}

module.exports = authenticate;
