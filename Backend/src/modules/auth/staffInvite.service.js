// Settings → Users & Permissions → "Invite Firm Member" (§5.2.1). A
// generic staff-role invite, distinct from employeeInvite.service.js
// (which is specifically the client-side, Case-linked employee/beneficiary
// invite flow). Deliberately reuses createInviteToken and the EXISTING,
// already-generic GET /api/auth/invite/:token + POST /api/auth/invite/:token/accept
// routes/controllers for the acceptance side — those two only special-case
// Case lookups (which simply resolve to null/no-op for a staff invite, not
// an error), so nothing there needed to change for this to work.
const User = require("../../models/User");
const { createInviteToken } = require("./employeeInvite.service");
const emailService = require("../email/email.service");

const STAFF_INVITE_ROLES = ["admin", "team_lead", "case_manager"];

async function inviteFirmMember({ name, email, role }, invitedBy) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw Object.assign(new Error("Email is required"), { status: 400 });
  if (!STAFF_INVITE_ROLES.includes(role)) {
    throw Object.assign(new Error(`role must be one of: ${STAFF_INVITE_ROLES.join(", ")}`), { status: 400 });
  }
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) throw Object.assign(new Error("A user with this email already exists"), { status: 409 });

  const user = await User.create({
    email: normalizedEmail,
    name: name || "",
    displayName: name || "",
    role,
    isActive: true,
    isEmailVerified: false,
  });
  const token = await createInviteToken(user);

  await emailService.sendTemplateEmail("staff-invitation", {
    to: user.email,
    data: { name: user.name || user.displayName || "there", role, invitedByName: invitedBy?.name || invitedBy?.displayName || "Your firm", token },
    userId: user._id,
    source: "shared",
  }).catch(() => {});

  return user;
}

module.exports = { inviteFirmMember, STAFF_INVITE_ROLES };
