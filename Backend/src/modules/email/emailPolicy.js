// Delivery policy: WHEN an email is sent, to WHOM, and when it must NOT be.
// Content lives in templates / eventTriggers.emails.js; this file is about the
// real-world sending decision. Two layers:
//
//  1. Per-trigger rules (EVENT_EMAIL_POLICY / SEND_RULES below): does this
//     event email automatically, how often may one person receive it for one
//     case, and the plain-language "when / not when" shown to admins.
//  2. Guards applied to EVERY email (email.service.js sendTemplateEmail and
//     the notification dispatcher): never a malformed or placeholder address,
//     never demo data, never a repeat of the same email to the same person for
//     the same case within a short window, never a client who cannot log in yet
//     (their activation email is the one exception), never the person who
//     performed the action.
const EmailLog = require("../../models/EmailLog");

// ── address guards ───────────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
// Placeholder/test domains never receive real mail (bounces hurt sender reputation).
// Override with EMAIL_BLOCKED_DOMAINS (comma-separated; empty string disables).
function blockedDomains() {
  const raw = process.env.EMAIL_BLOCKED_DOMAINS;
  return (raw === undefined ? "example.com,example.org,example.net" : raw).split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}
const BLOCKED_TLDS = ["test", "invalid", "localhost", "local"];

function undeliverableReason(address) {
  const value = String(address || "").trim().toLowerCase();
  if (!EMAIL_RE.test(value)) return "invalid_address";
  const domain = value.split("@")[1];
  if (blockedDomains().includes(domain) || BLOCKED_TLDS.includes(domain.split(".").pop())) return "placeholder_domain";
  return null;
}

// ── repeat guard ─────────────────────────────────────────────────────────
// True when the same email key already went to this address for this case
// within `windowMs` (a retried request, two code paths reporting one moment,
// or a burst such as ten uploads in a minute).
async function recentlySent({ templateKey, to, caseId, windowMs }) {
  if (!caseId || !windowMs) return false;
  const since = new Date(Date.now() - windowMs);
  const hit = await EmailLog.exists({ templateKey, to: String(to).toLowerCase(), caseId, status: { $in: ["sent", "queued"] }, createdAt: { $gte: since } });
  return Boolean(hit);
}

const MIN = 60 * 1000;
const DEFAULT_COOLDOWN_MS = 2 * MIN;
// Credential / security mails are always sent - a user asking twice must get it twice.
const NEVER_THROTTLED = new Set(["password-reset", "staff-credentials", "client-portal-invitation", "employee-case-invitation", "family-beneficiary-invitation"]);

// ── per-trigger policy ───────────────────────────────────────────────────
// auto: the email is sent by default (an admin can still switch it off, or
// replace its wording, on the Email Templates page). Everything not listed
// here still gets the in-app + browser-push alert but only emails once an
// admin activates a template for it - chatty operational events (every upload,
// every assignment) should not flood inboxes by default.
const EVENT_EMAIL_POLICY = {
  // client
  "attorney.assigned:client": { auto: true },
  "questionnaire.assigned:client": { auto: true, cooldownMin: 10 },
  "document.rejected:client": { auto: true, cooldownMin: 10 },
  "documents.requested:client": { auto: true, cooldownMin: 10 },
  // attorney
  "attorney.assigned:attorney": { auto: false }, // already emailed by the existing attorney-assignment email
  "attorney.removed:attorney": { auto: true },
  "rfe.received:attorney": { auto: true },
  "uscis.decision:attorney": { auto: true },
  "case.filed:attorney": { auto: true },
  "case.reopened:attorney": { auto: true },
  "questionnaire-progress-saved": { auto: true, cooldownMin: 30 }, // one email per case per 30 minutes while the client keeps saving
  "attorney.feedback:attorney": { auto: false, cooldownMin: 30 }, // superseded by "new-message-received"
  // case manager
  "case.tl_assigned:case_manager": { auto: true },
  "case.reopened:case_manager": { auto: true },
  "attorney.feedback:case_manager": { auto: false, cooldownMin: 30 }, // superseded by "new-message-received"
  // team lead
  "rfe.received:team_lead": { auto: true },
  "uscis.decision:team_lead": { auto: true },
  "case.escalated:team_lead": { auto: true, cooldownMin: 60 },
  // admin
  "rfe.received:admin": { auto: true },
  "uscis.decision:admin": { auto: true },
  "case.escalated:admin": { auto: true, cooldownMin: 60 },
  // super admin: critical / security only
  "case.escalated:super_admin": { auto: true, cooldownMin: 60 },
  "system.account_locked:super_admin": { auto: true, cooldownMin: 30 },
};

// Plain-language rules, shown on the Email Templates page and in the docs.
// `when` = trigger + audience; `unless` = the cases where nothing is sent.
const SEND_RULES = {
  // ── built-in emails (existing call sites; unchanged logic) ───────────
  "client-portal-invitation": { when: "A staff member creates a case for a client who has not set a password yet (also when the client asks for a new activation link).", unless: "The client already has an active account - they get the 'Case created' email instead, never both." },
  "employee-case-invitation": { when: "An employer invites an employee to complete their part of the case (or resends the invite).", unless: "The case is not in 'invite' mode, or the employee was already invited." },
  "family-beneficiary-invitation": { when: "A family-visa beneficiary is invited to the petitioner's case.", unless: "The beneficiary is completed by the petitioner themselves." },
  "password-reset": { when: "A user requests a password reset.", unless: "Never reveals whether the address exists; the account must be active." },
  "staff-credentials": { when: "A new staff or attorney account is created.", unless: "—" },
  "consultation-confirmation": { when: "A consultation is booked or confirmed - sent to the person who booked.", unless: "—" },
  "consultation-reschedule": { when: "A consultation is moved to a new time.", unless: "—" },
  "consultation-cancel": { when: "A consultation is cancelled.", unless: "—" },
  "consultation-host-notify": { when: "A new consultation is booked - sent to the host.", unless: "—" },
  "lead-approved": { when: "Staff approve a lead - sent to the prospect.", unless: "—" },
  "lead-rejected": { when: "Staff decline a lead - sent to the prospect.", unless: "—" },
  "quiz-lead-internal": { when: "A new lead or consultation request arrives - sent to the configured lead-notification address.", unless: "Eligibility-quiz submissions no longer notify anyone." },
  "case-created-client": { when: "A case is created for a client who already has a working portal account.", unless: "The client still has to set a password (they get the combined invitation email instead)." },
  "case-created-team-lead": { when: "A new case is created and routed to a team lead.", unless: "No team lead is assigned to the case." },
  "case-assigned-case-manager": { when: "A case is assigned to a case manager - sent to that case manager.", unless: "The case is already assigned to the same case manager." },
  "case-manager-assigned": { when: "A case manager is assigned - the client is told who it is.", unless: "The client has no email address." },
  "case-manager-reassigned": { when: "A case is reassigned to a different case manager - the client is told.", unless: "—" },
  "client-intake-submitted-case-manager": { when: "A client submits their intake - sent to the assigned case manager.", unless: "No case manager is assigned yet." },
  "attorney-assignment": { when: "An attorney is given access to a case - sent to that attorney.", unless: "The attorney already had active access." },
  "additional-info-requested": { when: "Staff request more information from a client or participant.", unless: "—" },
  "new-message-received": { when: "Someone sends a message and the recipient (client, attorney, case manager or team lead) is not signed in. Never administrators.", unless: "The recipient already got this email for the same case in the last 10 minutes, or is online." },
  "questionnaire-progress-saved": { when: "A client, employer or employee clicks Save progress on a checklist - sent to the case's assigned case manager only (never administrators).", unless: "No case manager is assigned, or they were already told about this case in the last 30 minutes." },
  "document-requested": { when: "Staff request documents from a client.", unless: "—" },
  "filing-submitted": { when: "The USCIS tracking status changes to 'filed' - sent to the client.", unless: "The status did not change." },
  "receipt-received": { when: "A USCIS receipt notice is recorded - sent to the client.", unless: "The status did not change." },
  "rfe-received": { when: "The USCIS tracking status changes to 'RFE issued' - sent to the client.", unless: "The status did not change." },
  "case-approved": { when: "The USCIS tracking status changes to 'approved' - sent to the client.", unless: "The status did not change." },
  "case-denied": { when: "The USCIS tracking status changes to 'denied' - sent to the client.", unless: "The status did not change." },
  "case-closed": { when: "The USCIS tracking status changes to 'closed' - sent to the client.", unless: "The status did not change." },
  "case-stage-changed": { when: "The USCIS tracking status changes to another notable stage - sent to the client.", unless: "The status did not change." },

  // ── event-based emails (new) ─────────────────────────────────────────
  "case.created:admin": { when: "A new case is created - every administrator.", unless: "You created it yourself." },
  "case.cm_assigned:team_lead": { when: "A case manager is assigned - the case's team lead.", unless: "You made the assignment yourself." },
  "case.cm_assigned:admin": { when: "A case manager is assigned - every administrator.", unless: "You made the assignment yourself." },
  "case.tl_assigned:case_manager": { when: "A team lead is assigned - the case's case manager.", unless: "You made the assignment yourself." },
  "attorney.assigned:client": { when: "An attorney is given access to the case - the client.", unless: "The client has not set a password yet." },
  "attorney.assigned:admin": { when: "An attorney is given access to a case - every administrator.", unless: "You granted the access yourself." },
  "attorney.removed:attorney": { when: "An attorney's access to a case is removed - that attorney.", unless: "—" },
  "questionnaire.assigned:client": { when: "A questionnaire is assigned - the person it is assigned to.", unless: "It is an internal profile questionnaire, or the person has not set a password yet." },
  "questionnaire.submitted:case_manager": { when: "A client submits a questionnaire - the case's case manager.", unless: "You submitted it yourself." },
  "document.rejected:client": { when: "Staff reject a document - the client who uploaded it.", unless: "The client has not set a password yet." },
  "documents.requested:client": { when: "Staff request documents - the client.", unless: "The client has not set a password yet; nothing was actually requested." },
  "document.uploaded:case_manager": { when: "The client uploads a document - the case's case manager.", unless: "Staff uploaded it." },
  "rfe.received:team_lead": { when: "USCIS issues an RFE - the case's team lead.", unless: "Reported again within a minute." },
  "rfe.received:admin": { when: "USCIS issues an RFE - every administrator.", unless: "Reported again within a minute." },
  "rfe.received:attorney": { when: "USCIS issues an RFE - the attorneys with access to the case.", unless: "Reported again within a minute." },
  "uscis.decision:team_lead": { when: "USCIS approves or denies a case - the case's team lead.", unless: "Reported again within a minute." },
  "uscis.decision:admin": { when: "USCIS approves or denies a case - every administrator.", unless: "Reported again within a minute." },
  "uscis.decision:attorney": { when: "USCIS approves or denies a case - the attorneys with access.", unless: "Reported again within a minute." },
  "case.filed:attorney": { when: "A case is filed with USCIS - the attorneys with access.", unless: "—" },
  "case.filed:team_lead": { when: "A case is filed with USCIS - the case's team lead.", unless: "—" },
  "case.closed:admin": { when: "A case is closed - every administrator.", unless: "—" },
  "case.closed:team_lead": { when: "A case is closed - the case's team lead.", unless: "—" },
  "case.reopened:case_manager": { when: "A closed case is reopened - the case's case manager.", unless: "You reopened it yourself." },
  "case.reopened:attorney": { when: "A closed case is reopened - the attorneys with access.", unless: "—" },
  "case.escalated:team_lead": { when: "A case passes its service-level deadline - the case's team lead (every team lead if the case has none).", unless: "Already escalated in the last hour." },
  "case.escalated:admin": { when: "A case passes its service-level deadline - every administrator.", unless: "Already escalated in the last hour." },
  "case.escalated:super_admin": { when: "A case passes its service-level deadline - every super admin (critical alert).", unless: "Already escalated in the last hour." },
  "system.email_failed:super_admin": { when: "An automated email fails to send - every super admin (in-app + push only; email would fail the same way).", unless: "The failing email was itself a system alert." },
  "system.account_locked:super_admin": { when: "An account is locked after repeated failed sign-ins - every super admin.", unless: "The account was already locked." },
  "lead.approved:admin": { when: "A lead is approved - every administrator.", unless: "—" },
  "attorney.feedback:case_manager": { when: "An attorney comments on a case - the case's case manager.", unless: "More than one comment within 30 minutes (one email per burst)." },
  "attorney.feedback:attorney": { when: "Staff reply to an attorney - that attorney.", unless: "More than one reply within 30 minutes (one email per burst)." },
};

function emailPolicyFor(key) {
  const policy = EVENT_EMAIL_POLICY[key] || {};
  return { auto: Boolean(policy.auto), cooldownMs: (policy.cooldownMin || 0) * MIN || DEFAULT_COOLDOWN_MS };
}

module.exports = {
  EVENT_EMAIL_POLICY, SEND_RULES, NEVER_THROTTLED, DEFAULT_COOLDOWN_MS,
  emailPolicyFor, undeliverableReason, recentlySent,
};
