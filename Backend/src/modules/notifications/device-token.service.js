const DeviceToken = require("../../models/DeviceToken");

// Upsert keyed on the token itself (not {userId, token}) — the same browser
// can log out and back in as a different user, and the token should follow
// whoever is currently authenticated rather than accumulate stale duplicates.
// The schema's unique index on `token` makes this race-safe.
async function registerDevice(userId, { token, browser, platform } = {}) {
  return DeviceToken.findOneAndUpdate(
    { token },
    { userId, token, browser, platform, active: true, lastUsedAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

// Scoped to {userId, token} so a user can only ever remove their own device.
async function unregisterDevice(userId, token) {
  return DeviceToken.deleteOne({ userId, token });
}

async function listDevices(userId) {
  return DeviceToken.find({ userId, active: true }).sort({ lastUsedAt: -1 });
}

async function deactivateToken(token) {
  return DeviceToken.updateOne({ token }, { active: false });
}

async function tokensForUser(userId) {
  return DeviceToken.find({ userId, active: true }).select("token").lean();
}

async function tokensForUsers(userIds) {
  return DeviceToken.find({ userId: { $in: userIds }, active: true }).select("userId token").lean();
}

module.exports = {
  registerDevice,
  unregisterDevice,
  listDevices,
  deactivateToken,
  tokensForUser,
  tokensForUsers,
};
