// Catalog of the automated emails the application ACTUALLY sends today. A
// "trigger" is the existing sendTemplateEmail() template key - the call sites
// across the app already decide when each one fires, so this file only adds
// the admin-facing metadata (label, category, who it normally goes to, which
// variable groups its call sites can supply). Events the app doesn't send yet
// (e.g. "document uploaded") are intentionally absent: a template attached
// to a trigger nothing fires would silently never send.
//
// recipient: the audience the call site addresses by default (matches
// email.service.js's TEMPLATE_AUDIENCE).
// locked:    security-critical emails (they carry credentials / reset links)
//            that must never be re-worded or disabled from the UI.

const CATEGORIES = ["Account", "Consultation", "Lead", "Case", "Documents", "Questionnaire", "Forms", "RFE", "Attorney", "Internal Team", "Case Status", "System"];

const CASE_GROUPS = ["Client", "Case", "Case Manager", "Team Lead", "Attorney", "Company", "Document"];
const t = (key, label, category, recipient, description, { groups = CASE_GROUPS, locked = false } = {}) =>
  ({ key, label, category, recipient, description, groups, locked });

const TRIGGERS = [
  t("client-portal-invitation", "Client Account Created", "Account", "client", "A client's portal account is created and they are asked to set a password.", { groups: ["Client", "Case"] }),
  t("employee-case-invitation", "Employee Invited to Case", "Account", "client", "An employer's employee is invited to complete their case.", { groups: ["Client", "Case", "Company"] }),
  t("family-beneficiary-invitation", "Beneficiary Invited to Case", "Account", "client", "A family-visa beneficiary is invited to the petitioner's case.", { groups: ["Client", "Case", "Company"] }),
  t("password-reset", "Password Reset", "Account", "client", "Password reset link. Locked for security.", { groups: ["Client"], locked: true }),
  t("staff-credentials", "Staff Credentials", "Internal Team", "team_member", "Login credentials for a new staff account. Locked for security.", { groups: ["Client"], locked: true }),

  t("consultation-confirmation", "Consultation Confirmed", "Consultation", "client", "A consultation booking is confirmed to the client.", { groups: ["Client"] }),
  t("consultation-reschedule", "Consultation Rescheduled", "Consultation", "client", "A consultation is moved to a new time.", { groups: ["Client"] }),
  t("consultation-cancel", "Consultation Cancelled", "Consultation", "client", "A consultation is cancelled.", { groups: ["Client"] }),
  t("consultation-host-notify", "Consultation Requested (Host Notice)", "Consultation", "team_member", "The consultation host is told about a new booking.", { groups: ["Client"] }),

  t("lead-approved", "Lead Approved", "Lead", "client", "A lead is approved and moves forward.", { groups: ["Client"] }),
  t("lead-rejected", "Lead Declined", "Lead", "client", "A lead is declined.", { groups: ["Client"] }),
  t("quiz-lead-internal", "New Lead Notice (Admin)", "Lead", "team_member", "The team is told about a new lead or consultation request.", { groups: ["Client"] }),

  t("case-created-client", "Case Created", "Case", "client", "A client is told their case has been created.", { groups: ["Client", "Case"] }),

  t("case-created-team-lead", "Case Created (Team Lead)", "Internal Team", "team_member", "The team lead is told a new case awaits assignment.", { groups: ["Client", "Case", "Team Lead"] }),
  t("case-assigned-case-manager", "Case Assigned to Case Manager", "Internal Team", "team_member", "A case manager is told a case was assigned to them.", { groups: ["Client", "Case", "Case Manager"] }),
  t("case-manager-assigned", "Case Manager Assigned", "Internal Team", "team_member", "A case manager assignment is announced.", { groups: ["Client", "Case", "Case Manager"] }),
  t("case-manager-reassigned", "Case Manager Reassigned", "Internal Team", "team_member", "A case is reassigned to a different case manager.", { groups: ["Client", "Case", "Case Manager"] }),
  t("client-intake-submitted-case-manager", "Client Intake Submitted", "Questionnaire", "team_member", "The case manager is told the client submitted their intake.", { groups: ["Client", "Case", "Case Manager"] }),

  t("attorney-assignment", "Attorney Assigned", "Attorney", "attorney", "An attorney is granted access to a case.", { groups: ["Client", "Case", "Case Manager", "Attorney"] }),

  t("additional-info-requested", "Additional Information Requested", "Questionnaire", "client", "The team asks the client for more information.", { groups: ["Client", "Case", "Case Manager", "Document"] }),

  t("document-requested", "Document Requested", "Documents", "client", "A client is asked to upload a document.", { groups: ["Client", "Case", "Document"] }),

  t("filing-submitted", "Filing Submitted", "Forms", "client", "A petition/application was filed with USCIS.", { groups: ["Client", "Case"] }),

  t("receipt-received", "Receipt Notice Received", "Case Status", "client", "A USCIS receipt notice arrived.", { groups: ["Client", "Case"] }),
  t("rfe-received", "RFE Received", "RFE", "client", "USCIS issued a Request for Evidence.", { groups: ["Client", "Case", "Case Manager", "Attorney"] }),
  t("case-stage-changed", "Case Status Changed", "Case Status", "client", "The case moved to a new stage.", { groups: ["Client", "Case", "Case Manager"] }),
  t("case-approved", "Case Approved", "Case Status", "client", "USCIS approved the case.", { groups: ["Client", "Case", "Case Manager", "Attorney"] }),
  t("case-denied", "Case Denied", "Case Status", "client", "USCIS denied the case.", { groups: ["Client", "Case", "Case Manager", "Attorney"] }),
  t("case-closed", "Case Closed", "Case Status", "client", "The case was closed.", { groups: ["Client", "Case", "Case Manager"] }),
];

// ── audience on the 35 built-in emails (for library filtering) ──────────
const BUILT_IN_AUDIENCE = {
  "case-created-team-lead": "team_lead",
  "consultation-host-notify": "admin", "quiz-lead-internal": "admin", "staff-credentials": "admin",
  "case-assigned-case-manager": "case_manager", "client-intake-submitted-case-manager": "case_manager",
  "case-manager-assigned": "client", "case-manager-reassigned": "client",
};
const RECIPIENT_AUDIENCE = { client: "client", attorney: "attorney", team_member: "case_manager" };
TRIGGERS.forEach((trigger) => {
  trigger.builtIn = true;
  trigger.available = true;
  trigger.audience = BUILT_IN_AUDIENCE[trigger.key] || RECIPIENT_AUDIENCE[trigger.recipient] || "client";
  if (trigger.key === "case-manager-assigned" || trigger.key === "case-manager-reassigned") trigger.recipient = "client";
});

// Event-based triggers (notification + push + optional customized email) - see eventTriggers.catalog.js.
const { EVENT_TRIGGERS, AUDIENCES, AUDIENCE_LABEL } = require("./eventTriggers.catalog");
TRIGGERS.push(...EVENT_TRIGGERS);

// Delivery policy + plain-language send rules (see emailPolicy.js).
const { emailPolicyFor, SEND_RULES } = require("./emailPolicy");
TRIGGERS.forEach((trigger) => {
  const policy = emailPolicyFor(trigger.key);
  // Built-in emails are sent by their existing call sites exactly as before; event emails follow the policy table.
  trigger.emailAuto = trigger.builtIn ? true : policy.auto;
  trigger.cooldownMs = policy.cooldownMs;
  trigger.sendRule = SEND_RULES[trigger.emailKey || trigger.key] || SEND_RULES[trigger.key] || null;
});

const BY_KEY = new Map(TRIGGERS.map((trigger) => [trigger.key, trigger]));

function getTrigger(key) { return BY_KEY.get(key) || null; }
// Every AVAILABLE event-based trigger fired by a business event (one per audience).
function forEvent(event) { return TRIGGERS.filter((trigger) => !trigger.builtIn && trigger.available && trigger.event === event); }
// What admins can pick/see: everything except hidden duplicates (their email lives on a built-in entry).
function listVisible() { return TRIGGERS.filter((trigger) => !trigger.hidden); }

// Who a template's To/CC/BCC rules may name. "custom" carries a literal
// address in `value`; every other type is resolved from the live case/user
// context at send time - addresses are never stored on the template.
const RECIPIENT_TYPES = [
  { type: "client", label: "Client", sample: "john.smith@example.com" },
  { type: "case_manager", label: "Case Manager", sample: "sarah.johnson@immiglance.com" },
  { type: "team_lead", label: "Team Lead", sample: "priya.patel@immiglance.com" },
  { type: "attorney", label: "Attorney", sample: "david.miller@lawfirm.com" },
  { type: "admin", label: "Admin", sample: "admin@immiglance.com" },
  { type: "super_admin", label: "Super Admin", sample: "superadmin@immiglance.com" },
  { type: "company_contact", label: "Employer / Company contact", sample: "hr@acme-tech.com" },
  { type: "custom", label: "Custom email address", sample: "" },
];

module.exports = { listVisible, CATEGORIES, TRIGGERS, RECIPIENT_TYPES, AUDIENCES, AUDIENCE_LABEL, getTrigger, forEvent };
