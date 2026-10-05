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
  t("staff-invitation", "Staff Invitation", "Internal Team", "team_member", "A new internal team member is invited.", { groups: ["Client"] }),

  t("consultation-confirmation", "Consultation Confirmed", "Consultation", "client", "A consultation booking is confirmed to the client.", { groups: ["Client"] }),
  t("consultation-reschedule", "Consultation Rescheduled", "Consultation", "client", "A consultation is moved to a new time.", { groups: ["Client"] }),
  t("consultation-cancel", "Consultation Cancelled", "Consultation", "client", "A consultation is cancelled.", { groups: ["Client"] }),
  t("consultation-host-notify", "Consultation Requested (Host Notice)", "Consultation", "team_member", "The consultation host is told about a new booking.", { groups: ["Client"] }),

  t("lead-approved", "Lead Approved", "Lead", "client", "A lead is approved and moves forward.", { groups: ["Client"] }),
  t("lead-rejected", "Lead Declined", "Lead", "client", "A lead is declined.", { groups: ["Client"] }),
  t("quiz-lead-confirmation", "Eligibility Quiz Result (Prospect)", "Lead", "client", "Result email to someone who completed the eligibility quiz.", { groups: ["Client"] }),
  t("quiz-lead-internal", "Eligibility Quiz Result (Team Notice)", "Lead", "team_member", "Internal notice about a completed quiz.", { groups: ["Client"] }),

  t("case-created-client", "Case Created", "Case", "client", "A client is told their case has been created.", { groups: ["Client", "Case"] }),
  t("payment-required", "Payment Required", "Case", "client", "A client is asked to complete a payment.", { groups: ["Client", "Case"] }),

  t("case-created-team-lead", "Case Created (Team Lead)", "Internal Team", "team_member", "The team lead is told a new case awaits assignment.", { groups: ["Client", "Case", "Team Lead"] }),
  t("case-assigned-case-manager", "Case Assigned to Case Manager", "Internal Team", "team_member", "A case manager is told a case was assigned to them.", { groups: ["Client", "Case", "Case Manager"] }),
  t("case-manager-assigned", "Case Manager Assigned", "Internal Team", "team_member", "A case manager assignment is announced.", { groups: ["Client", "Case", "Case Manager"] }),
  t("case-manager-reassigned", "Case Manager Reassigned", "Internal Team", "team_member", "A case is reassigned to a different case manager.", { groups: ["Client", "Case", "Case Manager"] }),
  t("client-intake-submitted-case-manager", "Client Intake Submitted", "Questionnaire", "team_member", "The case manager is told the client submitted their intake.", { groups: ["Client", "Case", "Case Manager"] }),

  t("attorney-assignment", "Attorney Assigned", "Attorney", "attorney", "An attorney is granted access to a case.", { groups: ["Client", "Case", "Case Manager", "Attorney"] }),

  t("questionnaire-assigned", "Questionnaire Assigned", "Questionnaire", "client", "A client is asked to complete a questionnaire.", { groups: ["Client", "Case", "Document"] }),
  t("additional-info-requested", "Additional Information Requested", "Questionnaire", "client", "The team asks the client for more information.", { groups: ["Client", "Case", "Case Manager", "Document"] }),

  t("document-requested", "Document Requested", "Documents", "client", "A client is asked to upload a document.", { groups: ["Client", "Case", "Document"] }),
  t("document-rejected", "Document Rejected", "Documents", "client", "An uploaded document is rejected and must be re-submitted.", { groups: ["Client", "Case", "Document"] }),

  t("signature-required", "Signature Required", "Forms", "client", "A form needs the client's signature.", { groups: ["Client", "Case", "Document"] }),
  t("filing-submitted", "Filing Submitted", "Forms", "client", "A petition/application was filed with USCIS.", { groups: ["Client", "Case"] }),

  t("receipt-received", "Receipt Notice Received", "Case Status", "client", "A USCIS receipt notice arrived.", { groups: ["Client", "Case"] }),
  t("rfe-received", "RFE Received", "RFE", "client", "USCIS issued a Request for Evidence.", { groups: ["Client", "Case", "Case Manager", "Attorney"] }),
  t("case-stage-changed", "Case Status Changed", "Case Status", "client", "The case moved to a new stage.", { groups: ["Client", "Case", "Case Manager"] }),
  t("case-on-hold", "Case On Hold", "Case Status", "client", "The case was put on hold.", { groups: ["Client", "Case", "Case Manager"] }),
  t("case-approved", "Case Approved", "Case Status", "client", "USCIS approved the case.", { groups: ["Client", "Case", "Case Manager", "Attorney"] }),
  t("case-denied", "Case Denied", "Case Status", "client", "USCIS denied the case.", { groups: ["Client", "Case", "Case Manager", "Attorney"] }),
  t("case-closed", "Case Closed", "Case Status", "client", "The case was closed.", { groups: ["Client", "Case", "Case Manager"] }),
];

const BY_KEY = new Map(TRIGGERS.map((trigger) => [trigger.key, trigger]));

function getTrigger(key) { return BY_KEY.get(key) || null; }

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

module.exports = { CATEGORIES, TRIGGERS, RECIPIENT_TYPES, getTrigger };
