// Links a staff-created case to its client's login (docs/MULTI_CASE_CLIENTS_PLAN.md). Used by single-party filings (H-4, EAD, I-765 EAD, change of
// status ...), which used to record the STAFF member as the case's user and invite nobody - so those cases never reached the client portal.
// Same rules as createCase: one login per e-mail; a new person gets an inactive account + a set-password invitation; a person who already has a
// login / cases gets the new case ADDED (never replaced) and a "case created - log in" e-mail, never a new set-password link.
const User = require("../../models/User");
const { normalizeRole } = require("../authorization/roleHierarchy");
const { pruneStaleCaseLinks, reclaimOrphanClientSideAccount } = require("../auth/staleCaseLinks");
const { generateOpaqueToken, hashToken } = require("../auth/password.service");
const { generateUniqueReferralCode } = require("../../utils/referralCode");
const caseLinks = require("./caseLinks.service");

const CLIENT_SETUP_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const refuse = (status, code, message) => Object.assign(new Error(message), { status, statusCode: status, code });

/**
 * Finds or creates the client for `email` and links `caseDoc` to them (does not save the case; sets caseDoc.user).
 * Returns { user, setupToken, createdUser, undo } - `undo()` puts the person's links back if the caller fails afterwards.
 * Throws (status 409) for an e-mail that belongs to a staff / attorney account, or a client who already has a case while MULTI_CASE_CLIENTS=false.
 */
async function attachClientToCase({ caseDoc, email, name, phone }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!cleanEmail) throw refuse(400, "CLIENT_EMAIL_REQUIRED", "Client email is required");
  const existing = await User.findOne({ email: cleanEmail }).select("+password +inviteTokenHash");
  if (existing && normalizeRole(existing.role) !== "client") await reclaimOrphanClientSideAccount(existing, "client");
  if (existing && normalizeRole(existing.role) !== "client") throw refuse(409, "EMAIL_OWNED_BY_NON_CLIENT", "This email address belongs to a non-client account");

  if (!existing) {
    const setupToken = generateOpaqueToken();
    const user = await User.create({
      email: cleanEmail,
      name: name || cleanEmail,
      displayName: name || cleanEmail,
      phone: phone || undefined,
      role: "client",
      referralCode: await generateUniqueReferralCode(User),
      isActive: false,
      isEmailVerified: false,
      mustSetPassword: true,
      inviteTokenHash: hashToken(setupToken),
      inviteTokenExpiresAt: new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS),
      primaryCaseId: caseDoc._id,
      caseIds: [caseDoc._id],
      caseRole: "single",
      principalCaseId: null,
    });
    caseDoc.user = user._id;
    return { user, setupToken, createdUser: true, undo: () => User.deleteOne({ _id: user._id }).catch(() => null) };
  }

  await pruneStaleCaseLinks(existing);
  const multiCase = caseLinks.multiCaseClientsEnabled();
  const hadCase = caseLinks.hasLinkedCase(existing);
  if (!multiCase && hadCase) throw refuse(409, "CLIENT_ALREADY_HAS_CASE", "This client account is already linked to a case");

  const snapshot = {
    primaryCaseId: existing.primaryCaseId || null, caseIds: [...(existing.caseIds || [])], caseRole: existing.caseRole || null, principalCaseId: existing.principalCaseId || null,
    isActive: existing.isActive, isEmailVerified: existing.isEmailVerified, mustSetPassword: existing.mustSetPassword || false,
    inviteTokenHash: existing.inviteTokenHash || null, inviteTokenExpiresAt: existing.inviteTokenExpiresAt || null,
  };
  let setupToken = null;
  if (caseLinks.needsSetPasswordInvite(existing, { hadCase: multiCase && hadCase })) {
    setupToken = generateOpaqueToken();
    existing.inviteTokenHash = hashToken(setupToken);
    existing.inviteTokenExpiresAt = new Date(Date.now() + CLIENT_SETUP_TOKEN_EXPIRY_MS);
    existing.mustSetPassword = true;
    existing.isActive = false;
    existing.isEmailVerified = false;
  }
  Object.assign(existing, caseLinks.planExistingPersonLinks(existing, [caseDoc._id], { caseRole: "single", principalCaseId: null }, { enabled: multiCase }));
  existing.name = existing.name || name;
  existing.displayName = existing.displayName || name;
  if (phone && !existing.phone) existing.phone = phone;
  await existing.save();
  caseDoc.user = existing._id;
  const undo = () => User.updateOne({ _id: existing._id }, { $set: snapshot }).catch(() => null);
  return { user: existing, setupToken, createdUser: false, undo };
}

/** Tells the client their case exists: set-password invitation for a new login, otherwise "case created - log in". In-app + browser + e-mail. Never throws. */
async function notifyClientOfNewCase({ caseDoc, user, setupToken, actor, req }) {
  try {
    const notificationService = require("../notifications/notification.service");
    const loginLink = `${require("../../config/env").clientUrl}/login`;
    await notificationService.createNotification({
      userId: user._id,
      type: "case_created",
      category: "case",
      title: setupToken ? "Your Immigration Case Is Ready" : "Your Immigration Case Has Been Created",
      message: `${caseDoc.caseNumber} - ${caseDoc.visaType}`,
      caseId: caseDoc._id,
      link: setupToken ? "/accept-invite" : "/dashboard",
      priority: "medium",
      source: "shared",
      emailTo: user.email,
      ...(setupToken
        ? { emailTemplate: "client-portal-invitation", emailData: { clientName: caseDoc.clientName, caseNumber: caseDoc.caseNumber, visaType: caseDoc.visaType, token: setupToken } }
        : { emailTemplate: "case-created-client", emailData: { clientName: caseDoc.clientName, caseNumber: caseDoc.caseNumber, visaType: caseDoc.visaType, loginLink } }),
    }, actor, req);
  } catch (error) {
    require("../../utils/logger").error("client_new_case_notify_failed", { caseId: String(caseDoc._id), error: error.message });
  }
}

module.exports = { attachClientToCase, notifyClientOfNewCase };
