const userService = require("./user.service");
const User = require("../../models/User");
const realtimeGateway = require("../realtime/realtime.gateway");

async function getPresence(req, res, next) {
  try {
    const ids = String(req.query.ids || "").split(",").map((id) => id.trim()).filter(Boolean);
    const presence = {};
    const offlineIds = [];
    for (const id of ids) {
      if (realtimeGateway.isUserOnline(id)) {
        presence[id] = { isOnline: true, lastSeenAt: null };
      } else {
        offlineIds.push(id);
        presence[id] = { isOnline: false, lastSeenAt: null };
      }
    }
    if (offlineIds.length) {
      const offlineUsers = await User.find({ _id: { $in: offlineIds } }).select("lastSeenAt");
      for (const offlineUser of offlineUsers) {
        presence[offlineUser._id.toString()].lastSeenAt = offlineUser.lastSeenAt || null;
      }
    }
    res.json({ success: true, presence });
  } catch (error) {
    next(error);
  }
}

async function getUsers(req, res, next) {
  try {
    const result = await userService.listUsers(req.query, req.user);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function getAssignableUsers(req, res, next) {
  try {
    const users = await userService.getAssignableUsers(req.user, req.query.role, {
      includeCaseClients: req.query.includeCaseClients === "true" || req.query.includeCaseClients === true,
    });
    res.json({ success: true, count: users.length, users });
  } catch (error) {
    next(error);
  }
}

async function getCaseManagers(req, res, next) {
  try {
    const caseManagers = await userService.getAssignableUsers(req.user, "case_manager");
    res.json({ success: true, count: caseManagers.length, caseManagers });
  } catch (error) {
    next(error);
  }
}

async function getAttorneys(req, res, next) {
  try {
    const attorneys = await userService.getAssignableUsers(req.user, "attorney");
    res.json({ success: true, count: attorneys.length, attorneys });
  } catch (error) {
    next(error);
  }
}

async function getDashboard(req, res, next) {
  try {
    const dashboard = await userService.getDashboard(req.user);
    res.json({ success: true, dashboard });
  } catch (error) {
    next(error);
  }
}

async function getUser(req, res, next) {
  try {
    const user = await userService.getUserOrThrow(req.params.id, req.user);
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
}

async function getUserActivity(req, res, next) {
  try {
    const activity = await userService.getUserActivity(req.params.id, req.user);
    res.json({ success: true, ...activity });
  } catch (error) {
    next(error);
  }
}

async function getUserPerformance(req, res, next) {
  try {
    const performance = await userService.getUserPerformance(req.params.id, req.user);
    res.json({ success: true, ...performance });
  } catch (error) {
    next(error);
  }
}

async function createUser(req, res, next) {
  try {
    const user = await userService.createUser(req.body, req.user, req);
    res.status(201).json({ success: true, user });
  } catch (error) {
    next(error);
  }
}

async function updateUser(req, res, next) {
  try {
    const user = await userService.updateUser(req.params.id, req.body, req.user, req);
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
}

async function deleteUser(req, res, next) {
  try {
    await userService.deactivateUser(req.params.id, req.user, req);
    res.json({ success: true, message: "User deactivated successfully" });
  } catch (error) {
    next(error);
  }
}

async function updateStatus(req, res, next) {
  try {
    const user = await userService.updateUser(req.params.id, { isActive: req.body.isActive ?? req.body.active }, req.user, req);
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
}

// Settings → Users & Permissions → "Invite Firm Member" (§5.2.1).
async function inviteFirmMember(req, res, next) {
  try {
    const { inviteFirmMember: invite } = require("../auth/staffInvite.service");
    const user = await invite({ name: req.body.name, email: req.body.email, role: req.body.role }, req.user);
    res.status(201).json({ success: true, user: { _id: user._id, email: user.email, name: user.name, role: user.role } });
  } catch (error) {
    next(error);
  }
}

// Settings → Users & Permissions → "Locked Users" panel (§5.8).
async function listLockedUsers(req, res, next) {
  try {
    const User = require("../../models/User");
    const locked = await User.find({ lockedUntil: { $gt: new Date() } }).select("name displayName email role lockedUntil failedLoginAttempts");
    res.json({ success: true, users: locked });
  } catch (error) {
    next(error);
  }
}

async function unlockUser(req, res, next) {
  try {
    const User = require("../../models/User");
    const user = await User.findByIdAndUpdate(req.params.id, { $set: { failedLoginAttempts: 0 }, $unset: { lockedUntil: 1 } }, { new: true }).select("name displayName email role lockedUntil");
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    res.json({ success: true, user });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createUser,
  deleteUser,
  getAssignableUsers,
  getAttorneys,
  getCaseManagers,
  getDashboard,
  getPresence,
  getUser,
  getUserActivity,
  getUserPerformance,
  getUsers,
  updateStatus,
  updateUser,
  inviteFirmMember,
  listLockedUsers,
  unlockUser,
};
