// Delegate employer: ONE employer entity, ONE employer data set, TWO employer-side logins.
//
// The delegate is another authorised person acting as the employer on the same case. He has his own credentials and his
// own audit identity (User), but:
//   - there is NO delegate-owned company data anywhere: employer / petitioner / job / signatory information lives in the
//     single existing employer record that the primary employer already uses, and both logins read and write it;
//   - he gets exactly the access the primary employer has (Case.delegateEmployerUser is honoured by canAccessCase and by
//     the case-list filter), so the dashboard, checklists, questionnaires, documents, forms and employee management are
//     the same screens - not a separate delegate experience;
//   - on employee (child) cases he follows the employer: he can reach a child while the employer holds it, and loses it
//     when an invited employee takes it over (the existing "employer cannot read an invited employee's file" boundary).
const crypto = require("crypto");
const User = require("../../models/User");
const Case = require("../../models/Case");
const notificationService = require("../notifications/notification.service");
const logger = require("../../utils/logger");

const SETUP_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const STAFF_ACCOUNT_ROLES = new Set(["super_admin", "admin", "team_lead", "case_manager", "attorney", "paralegal", "finance", "finance_team", "hr", "reviewer"]);

const sameId = (left, right) => Boolean(left && right && String(left._id || left) === String(right._id || right));
const clean = (value) => String(value ?? "").trim();
const cleanEmail = (value) => clean(value).toLowerCase();
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const generateToken = () => crypto.randomBytes(32).toString("hex");
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

// True for the primary employer (Case.user) AND the delegate - the one definition of "employer side" used by every
// owner check, so the two logins are interchangeable wherever the employer is allowed to act.
function isEmployerSide(principal, user) {
  if (!principal || !user) return false;
  return sameId(principal.user, user._id) || sameId(principal.delegateEmployerUser, user._id);
}

function isDelegateOf(principal, user) {
  return Boolean(principal && user && sameId(principal.delegateEmployerUser, user._id));
}

// Validates the optional delegate block of a create-case request. Returns null when no delegate was given.
function parseDelegateInput(body = {}, employerEmail) {
  const email = cleanEmail(body.delegateEmployerEmail || body.delegateEmployer?.email);
  const name = clean(body.delegateEmployerName || body.delegateEmployer?.name);
  const phone = clean(body.delegateEmployerPhone || body.delegateEmployer?.phone);
  if (!email && !name && !phone) return null;
  const fail = (message, code) => Object.assign(new Error(message), { status: 400, code });
  if (!email || !EMAIL_PATTERN.test(email)) throw fail("Delegate employer needs a valid email address", "INVALID_DELEGATE_EMAIL");
  if (!name) throw fail("Delegate employer needs a name", "INVALID_DELEGATE_NAME");
  if (email === cleanEmail(employerEmail)) throw fail("The delegate employer must use a different email from the employer - each person signs in with their own credentials", "DELEGATE_EMAIL_MATCHES_EMPLOYER");
  return { name, email, phone };
}

// Throws before anything is created when the delegate's email already belongs to a staff / attorney account.
async function assertDelegateEmailUsable(email) {
  const existing = await User.findOne({ email }).select("role").lean();
  if (existing && STAFF_ACCOUNT_ROLES.has(String(existing.role || "").toLowerCase().replace(/[\s-]+/g, "_"))) {
    throw Object.assign(new Error("That email belongs to a team member account and cannot be used as a delegate employer. Use the delegate's own email.", ), { status: 409, code: "DELEGATE_EMAIL_IN_USE" });
  }
}

// Creates (or reuses) the delegate's login and links it to the principal case and its child cases. Does NOT send email -
// the caller sends the invitation once the case is fully set up (see sendDelegateInvitation).
async function attachDelegateEmployer(principalCase, childCases, input, actor) {
  await assertDelegateEmailUsable(input.email);
  let user = await User.findOne({ email: input.email }).select("+password");
  const wasExisting = Boolean(user);
  let setupToken = null;
  const caseIds = [principalCase._id, ...(childCases || []).map((child) => child._id)];
  if (!user) {
    setupToken = generateToken();
    [user] = await User.create([{
      email: input.email,
      name: input.name,
      displayName: input.name,
      phone: input.phone || undefined,
      role: "client",
      isActive: false,
      isEmailVerified: false,
      mustSetPassword: true,
      inviteTokenHash: hashToken(setupToken),
      inviteTokenExpiresAt: new Date(Date.now() + SETUP_TOKEN_EXPIRY_MS),
      primaryCaseId: principalCase._id,
      caseIds,
      caseRole: "principal",
      principalCaseId: null,
    }]);
  } else {
    // An existing account that has not set a password yet gets a fresh invitation, exactly like an existing employer.
    if (!user.password && !user.inviteTokenHash) {
      setupToken = generateToken();
      user.inviteTokenHash = hashToken(setupToken);
      user.inviteTokenExpiresAt = new Date(Date.now() + SETUP_TOKEN_EXPIRY_MS);
      user.mustSetPassword = true;
      user.isActive = false;
    }
    user.primaryCaseId = user.primaryCaseId || principalCase._id;
    user.name = user.name || input.name;
    user.displayName = user.displayName || input.name;
    await user.save();
    await User.updateOne({ _id: user._id }, { $addToSet: { caseIds: { $each: caseIds } } });
  }

  principalCase.delegateEmployerUser = user._id;
  principalCase.delegateEmployer = { name: input.name, email: input.email, phone: input.phone || undefined, invitedAt: new Date(), invitedBy: actor?._id };
  await principalCase.save();
  const holdableChildIds = (childCases || []).filter((child) => !child.user || sameId(child.user, principalCase.user)).map((child) => child._id);
  if (holdableChildIds.length) await Case.updateMany({ _id: { $in: holdableChildIds } }, { $set: { delegateEmployerUser: user._id } });
  return { user, setupToken, created: !wasExisting };
}

// The SAME email the primary employer receives: a set-your-password invitation when the account has no password yet,
// otherwise the "case created" login email.
async function sendDelegateInvitation(principalCase, delegate, setupToken, actor, req) {
  const base = {
    userId: delegate._id,
    type: "case_created",
    category: "case",
    caseId: principalCase._id,
    priority: "medium",
    source: "shared",
  };
  const caseNumber = principalCase.caseNumber;
  const company = principalCase.petitionerName || principalCase.clientName;
  if (setupToken) {
    return notificationService.createNotification({
      ...base,
      title: "Your Immigration Case Is Ready",
      message: `${caseNumber} - ${principalCase.visaType}`,
      link: "/accept-invite",
      emailTemplate: "client-portal-invitation",
      emailTo: delegate.email,
      emailData: { clientName: delegate.name || delegate.displayName, caseNumber, visaType: principalCase.visaType, employerName: company, token: setupToken },
    }, actor, req).catch((error) => { logger.error("delegate_invitation_failed", { error: error.message }); return null; });
  }
  const clientUrl = require("../../config/env").clientUrl;
  return notificationService.createNotification({
    ...base,
    title: "You were added to an employer case",
    message: `${caseNumber} · ${principalCase.visaType}`,
    link: "/dashboard",
    emailTemplate: "case-created-client",
    emailTo: delegate.email,
    emailData: { clientName: delegate.name || delegate.displayName, caseNumber, visaType: principalCase.visaType, loginLink: `${clientUrl}/login` },
  }, actor, req).catch((error) => { logger.error("delegate_invitation_failed", { error: error.message }); return null; });
}

// Keeps the delegate in lock-step with whoever holds an employee case: while the employer holds it the delegate can
// reach it; when an invited employee takes it over, the delegate (like the employer) steps out; when it comes back,
// the delegate comes back with it.
async function followEmployerHolding(principal, childCase, employerHolds) {
  if (!principal?.delegateEmployerUser) return;
  childCase.delegateEmployerUser = employerHolds ? principal.delegateEmployerUser : null;
  if (employerHolds) await User.updateOne({ _id: principal.delegateEmployerUser }, { $addToSet: { caseIds: childCase._id } });
  else await User.updateOne({ _id: principal.delegateEmployerUser }, { $pull: { caseIds: childCase._id } });
}

module.exports = { isEmployerSide, isDelegateOf, parseDelegateInput, attachDelegateEmployer, sendDelegateInvitation, followEmployerHolding, assertDelegateEmailUsable };
