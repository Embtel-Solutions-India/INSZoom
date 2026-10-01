// Settings -> Users & Permissions -> "Add Firm Member". The admin picks the
// role and sets (or generates) the password; the new team member / attorney
// receives an email with the correct portal link for their role (Admin or
// Attorney portal), their login email and that password. There is no
// token / "activate your account" step - the account is ready to sign in.
const crypto = require("crypto");
const User = require("../../models/User");
const emailService = require("../email/email.service");

const STAFF_INVITE_ROLES = ["super_admin", "admin", "team_lead", "case_manager", "attorney"];
// Roles that sign in to the Admin or Attorney portal (everything else is a
// client-side account that is invited through the client flows).
const CLIENT_SIDE_ROLES = ["client", "user", "employer", "employee", "beneficiary", "professor", "joint_sponsor"];

function isInternalRole(role) {
  return Boolean(role) && !CLIENT_SIDE_ROLES.includes(role);
}

// 14 chars from an unambiguous alphabet (no 0/O/1/l/I), guaranteed to mix
// upper, lower, digit and symbol.
function generatePassword() {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?"];
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  const all = sets.join("");
  const chars = [...sets.map(pick), ...Array.from({ length: 10 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

// Emails the portal link + login email + password. Never throws: a mail
// failure must not roll back the account (the admin can see it in the email
// log and resend), same contract as every other sendTemplateEmail caller.
async function sendStaffCredentialsEmail({ user, password, invitedBy }) {
  return emailService.sendTemplateEmail("staff-credentials", {
    to: user.email,
    recipientRole: user.role,
    data: {
      name: user.name || user.displayName || "there",
      role: user.role,
      email: user.email,
      password,
      invitedByName: invitedBy?.name || invitedBy?.displayName || "Your firm",
    },
    userId: user._id,
    source: "shared",
  }).catch(() => ({ sent: false }));
}

async function inviteFirmMember({ name, email, role, password }, invitedBy) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) throw Object.assign(new Error("Email is required"), { status: 400 });
  if (!STAFF_INVITE_ROLES.includes(role)) {
    throw Object.assign(new Error(`role must be one of: ${STAFF_INVITE_ROLES.join(", ")}`), { status: 400 });
  }
  if (password && String(password).length < 8) {
    throw Object.assign(new Error("Password must be at least 8 characters"), { status: 400 });
  }
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) throw Object.assign(new Error("A user with this email already exists"), { status: 409 });

  const finalPassword = password || generatePassword();
  const user = await User.create({
    email: normalizedEmail,
    name: name || "",
    displayName: name || "",
    role,
    password: finalPassword,
    isActive: true,
    // The admin vouches for this address by creating the account, and the
    // credentials go to it - there is no separate verification step.
    isEmailVerified: true,
  });

  await sendStaffCredentialsEmail({ user, password: finalPassword, invitedBy });
  return user;
}

module.exports = { inviteFirmMember, sendStaffCredentialsEmail, generatePassword, isInternalRole, STAFF_INVITE_ROLES };
