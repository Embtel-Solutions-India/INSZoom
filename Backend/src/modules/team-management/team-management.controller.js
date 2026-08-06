const User = require("../../models/User");
const { invalidateUserCache } = require("../../config/redis");

const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];

// Roles each actor role may CREATE, and may reassign an existing user TO.
// This governs role CHANGES specifically - a much bigger action than a
// credentials edit (it changes what the target account can DO) - so it
// stays on the original, narrower hierarchy even though credentials-editing
// below is broader. team_lead can never reassign anyone's role through this
// endpoint; it's listed here only so the CREATE flow can default new hires
// to case_manager.
const ASSIGNABLE_ROLES = {
  super_admin: ["super_admin", "admin", "team_lead", "case_manager"],
  admin: ["admin", "team_lead", "case_manager"],
  team_lead: ["case_manager"],
};

function canChangeRole(actorUser, newRole) {
  if (actorUser.role === "team_lead") return false; // never, not even to case_manager, via edit
  return (ASSIGNABLE_ROLES[actorUser.role] || []).includes(newRole);
}

// Credentials (name/email/password) edit permission — any staff role at
// team_lead or above can edit ANY other staff member's credentials here,
// including super_admin's. This is intentionally broader than the
// access-control actions below (isActive toggle, delete): a team_lead can
// reset an admin's password through this page by design, per product
// decision - it does NOT extend to changing roles or deactivating/removing
// higher-privileged accounts, which stay governed by canRemoveOrDeactivate.
function canEditCredentials(actorUser) {
  return ["super_admin", "admin", "team_lead"].includes(actorUser.role);
}

// Governs BOTH the isActive toggle (PATCH) and hard delete (DELETE) - they
// are the same access-control action (soft-deactivate) reached two ways, so
// they must share one rule or a team_lead could deactivate an admin through
// the isActive PATCH path even though DELETE blocks it outright.
//
//   super_admin  — nobody may deactivate/remove.
//   admin        — only super_admin may deactivate/remove.
//   team_lead    — super_admin, admin, or any other team_lead may
//                  deactivate/remove (no team scoping between peer leads).
//   case_manager — super_admin/admin may always remove; a team_lead may
//                  remove a case_manager only on their own team. teamId is
//                  null for small orgs that haven't set up teams yet - in
//                  that case a team_lead intentionally manages ALL case
//                  managers rather than none, matching how listing/creation
//                  already treat a null teamId as "no team structure set
//                  up, so scope is everyone" instead of "scope is nobody."
function canRemoveOrDeactivate(actorUser, targetUser) {
  if (actorUser._id.toString() === targetUser._id.toString()) return false;
  const actorRole = actorUser.role;
  const targetRole = targetUser.role;
  if (targetRole === "super_admin") return false;
  if (targetRole === "admin") return actorRole === "super_admin";
  if (targetRole === "team_lead") return ["super_admin", "admin", "team_lead"].includes(actorRole);
  if (targetRole === "case_manager") {
    if (["super_admin", "admin"].includes(actorRole)) return true;
    if (actorRole === "team_lead") {
      if (!actorUser.teamId) return true; // null teamId => manage all, see comment above
      return actorUser.teamId.toString() === targetUser.teamId?.toString();
    }
  }
  return false;
}

// GET /api/team-members
// super_admin, admin, and team_lead all see the full staff roster - team_lead
// included, per product decision (they need visibility into the whole team
// even though their edit/delete powers stay narrower for some targets).
exports.list = async (req, res, next) => {
  try {
    const members = await User.find({ role: { $in: STAFF_ROLES } }).sort({ createdAt: 1 });
    res.json({ success: true, count: members.length, users: members });
  } catch (e) { next(e); }
};

// POST /api/team-members
exports.create = async (req, res, next) => {
  try {
    const { email, password, name, role } = req.body;
    if (!email || !password || !name)
      return res.status(400).json({ success: false, message: "email, password, and name are required." });
    if (password.length < 8)
      return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });

    const assignRole = role || "case_manager";
    if (!(ASSIGNABLE_ROLES[req.user.role] || []).includes(assignRole))
      return res.status(403).json({ success: false, message: `Your role cannot create a ${assignRole} account.` });

    if (await User.findOne({ email: email.toLowerCase() }))
      return res.status(409).json({ success: false, message: "A user with this email already exists." });

    const doc = new User({
      email: email.toLowerCase(),
      password, // pre-save hook hashes
      name,
      displayName: name,
      role: assignRole,
      teamId: req.user.teamId || null,
      isActive: true,
      isEmailVerified: true,
      isDemoData: false,
    });
    await doc.save();
    const safe = await User.findById(doc._id);
    res.status(201).json({ success: true, user: safe });
  } catch (e) { next(e); }
};

// PATCH /api/team-members/:id
exports.update = async (req, res, next) => {
  try {
    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: "User not found." });

    const { name, email, password, isActive, role } = req.body;
    const touchesCredentials = name !== undefined || email !== undefined || Boolean(password);

    if (touchesCredentials && !canEditCredentials(req.user))
      return res.status(403).json({ success: false, message: "You do not have permission to edit this user." });

    if (isActive !== undefined && !canRemoveOrDeactivate(req.user, target))
      return res.status(403).json({ success: false, message: "You do not have permission to change this user's active status." });

    if (role && role !== target.role) {
      if (!canChangeRole(req.user, role))
        return res.status(403).json({ success: false, message: `Your role cannot assign the ${role} role.` });
      target.role = role;
    }

    if (name) { target.name = name; target.displayName = name; }
    if (email) target.email = email.toLowerCase();
    if (typeof isActive === "boolean") target.isActive = isActive;
    if (password && password.trim()) {
      if (password.trim().length < 8)
        return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
      target.password = password;
    }

    await target.save();
    await invalidateUserCache(target._id).catch(() => {});
    const safe = await User.findById(target._id);
    res.json({ success: true, user: safe });
  } catch (e) { next(e); }
};

// DELETE /api/team-members/:id  (soft deactivate — never hard delete)
exports.remove = async (req, res, next) => {
  try {
    if (req.params.id === req.user._id.toString())
      return res.status(403).json({ success: false, message: "You cannot delete your own account." });

    const target = await User.findById(req.params.id);
    if (!target) return res.status(404).json({ success: false, message: "User not found." });
    if (!canRemoveOrDeactivate(req.user, target))
      return res.status(403).json({ success: false, message: `Your role cannot delete a ${target.role} account.` });

    target.isActive = false;
    target.deactivatedAt = new Date();
    target.deactivatedBy = req.user._id;
    await target.save();
    await invalidateUserCache(target._id).catch(() => {});
    res.json({ success: true, message: "User deactivated." });
  } catch (e) { next(e); }
};
