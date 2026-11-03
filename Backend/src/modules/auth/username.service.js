const User = require("../../models/User");

// Shared by clientInvite.service.js and employeeInvite.service.js's invite-
// acceptance flows - resolves the username to store on `user` (mutates and
// returns it, does not save): the requester's chosen value if unique, or a
// sanitized email-prefix default if none was chosen. Throws a typed
// USERNAME_TAKEN error the controller can propagate as a 409.
async function resolveUsername(user, requestedUsername) {
  if (requestedUsername && requestedUsername.trim()) {
    const candidate = requestedUsername.trim().toLowerCase();
    const existing = await User.findOne({ username: candidate });
    if (existing && existing._id.toString() !== user._id.toString()) {
      const error = new Error("That username is already taken. Please choose another.");
      error.code = "USERNAME_TAKEN";
      error.status = 409;
      throw error;
    }
    return candidate;
  }
  // No username chosen: derive one from the email. It must be unique (usernames carry a unique index), so when the derived name is already
  // another account's (two clients at "info@..."), add a number instead of letting the save fail and the password never being set.
  const base = user.email.split("@")[0].toLowerCase().replace(/[^a-z0-9._-]/g, "") || "user";
  let candidate = base;
  for (let attempt = 2; attempt < 50; attempt += 1) {
    const existing = await User.findOne({ username: candidate }).select("_id").lean();
    if (!existing || existing._id.toString() === user._id.toString()) return candidate;
    candidate = `${base}${attempt}`;
  }
  return `${base}${Date.now().toString(36)}`;
}

module.exports = { resolveUsername };
