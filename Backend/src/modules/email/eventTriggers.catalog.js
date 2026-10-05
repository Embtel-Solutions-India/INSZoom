// Event-based triggers: one entry per (business event, audience). Unlike the
// 35 built-in emails (which are keyed by an existing sendTemplateEmail
// template), these have no built-in email - what they own is the notification
// (in-app + socket + browser push) and, once an admin ACTIVATES a customized
// template for the trigger, an email. Nothing new is emailed by default.
//
// Events in the notification plan that the application cannot produce yet (the
// team-lead review flow, attorney review requests, unassigned-case sweeps, ...)
// are deliberately NOT listed: a template for them could never send.
//
// `hidden` + `emailKey`: this moment already has a built-in email (emailKey).
// The event still sends the in-app + push notification, but its email is
// customized through that built-in template, so the library shows ONE entry
// for the moment instead of two near-identical ones.
//
// The dispatcher (notifications/triggerEvents.service.js) is the only thing
// that fires these; call sites emit(<event>, ...) and never name an audience.

const AUDIENCES = ["client", "case_manager", "team_lead", "admin", "super_admin", "attorney"];
const AUDIENCE_LABEL = { client: "Client", case_manager: "Case Manager", team_lead: "Team Lead", admin: "Admin", super_admin: "Super Admin", attorney: "Attorney" };

const CASE_GROUPS = ["Client", "Case", "Case Manager", "Team Lead", "Attorney", "Company", "Document"];

// event, audience, label, category, push title/message (may use [variables]),
// plus notification type / priority. `critical` marks the few alerts a Super
// Admin should receive (they do NOT get ordinary case notifications).
const live = (event, audience, label, category, title, message, { type = "general", priority = "medium", description, groups = CASE_GROUPS, hidden = false, emailKey = null } = {}) => ({
  key: `${event}:${audience}`, event, audience, label, category, recipient: audience === "client" ? "client" : audience === "attorney" ? "attorney" : "team_member",
  description: description || message, groups, locked: false, builtIn: false, available: true,
  push: { title, message }, type, priority, hidden, emailKey,
});


const EVENT_TRIGGERS = [
  // ── Case created / assigned ──────────────────────────────────────────
  live("case.created", "admin", "New Case Created (Admin)", "Case", "New case created", "[client.name] - [case.id] ([case.visa_type])", { type: "case_created" }),
  live("case.cm_assigned", "team_lead", "Case Manager Assigned (Team Lead)", "Internal Team", "Case manager assigned", "[casemanager.name] now manages [case.id] for [client.name].", { type: "case_assigned" }),
  live("case.cm_assigned", "admin", "Case Assignment Completed (Admin)", "Internal Team", "Case assignment completed", "[casemanager.name] was assigned to [case.id] ([client.name]).", { type: "case_assigned" }),
  live("case.tl_assigned", "case_manager", "Team Lead Assigned (Case Manager)", "Internal Team", "Team lead assigned", "[teamlead.name] is now the team lead for [case.id].", { type: "case_assigned" }),

  // ── Attorney ─────────────────────────────────────────────────────────
  live("attorney.assigned", "attorney", "Attorney Assigned to Case (Attorney)", "Attorney", "You were assigned to a case", "You now have access to case [case.id] for [client.name].", { type: "attorney_access_granted", priority: "high", hidden: true, emailKey: "attorney-assignment" }),
  live("attorney.assigned", "client", "Attorney Assigned (Client)", "Attorney", "An attorney was assigned to your case", "[attorney.name] has been assigned to your case [case.id].", { type: "case_assigned" }),
  live("attorney.assigned", "admin", "Attorney Assigned (Admin)", "Attorney", "Attorney assigned", "[attorney.name] was assigned to [case.id] ([client.name]).", { type: "case_assigned" }),
  live("attorney.removed", "attorney", "Case Transferred Away From Attorney", "Attorney", "Case access removed", "Your access to case [case.id] has been removed.", { type: "case_reassigned" }),

  // ── Questionnaires / documents ───────────────────────────────────────
  live("questionnaire.assigned", "client", "Questionnaire Available (Client)", "Questionnaire", "Questionnaire available", "A new questionnaire is ready for you to complete for case [case.id].", { type: "questionnaire_assigned", priority: "high" }),
  live("questionnaire.submitted", "case_manager", "Client Completed Questionnaire (Case Manager)", "Questionnaire", "Questionnaire completed", "[client.name] completed a questionnaire for case [case.id].", { type: "questionnaire_submitted", priority: "high" }),
  live("document.rejected", "client", "Document Rejected / Replacement Required (Client)", "Documents", "Document rejected", "[document.name] on case [case.id] needs to be replaced: [document.rejection_reason]", { type: "document_rejected", priority: "high" }),
  live("documents.requested", "client", "Documents Requested (Client)", "Documents", "Documents requested", "Please upload the requested documents for case [case.id].", { type: "document_requested", priority: "high", hidden: true, emailKey: "document-requested" }),
  live("document.uploaded", "case_manager", "Client Uploaded Documents / Needs Review (Case Manager)", "Documents", "New document to review", "[client.name] uploaded [document.name] on case [case.id] - it needs your review.", { type: "new_document_uploaded", priority: "high" }),

  // ── RFE / USCIS ──────────────────────────────────────────────────────
  live("rfe.received", "team_lead", "RFE Received (Team Lead)", "RFE", "RFE received", "USCIS issued an RFE on [case.id] ([client.name]). Deadline: [case.rfe_deadline].", { type: "rfe_received", priority: "urgent" }),
  live("rfe.received", "admin", "RFE Received (Admin)", "RFE", "RFE received", "USCIS issued an RFE on [case.id] ([client.name]). Deadline: [case.rfe_deadline].", { type: "rfe_received", priority: "urgent" }),
  live("rfe.received", "attorney", "RFE Received (Attorney)", "RFE", "RFE response required", "USCIS issued an RFE on [case.id] ([client.name]). Deadline: [case.rfe_deadline].", { type: "rfe_received", priority: "urgent" }),
  live("uscis.decision", "team_lead", "USCIS Decision Received (Team Lead)", "Case Status", "USCIS decision received", "USCIS decided case [case.id] ([client.name]): [case.status].", { type: "case_approved", priority: "urgent" }),
  live("uscis.decision", "admin", "USCIS Decision Received (Admin)", "Case Status", "USCIS decision received", "USCIS decided case [case.id] ([client.name]): [case.status].", { type: "case_approved", priority: "urgent" }),
  live("uscis.decision", "attorney", "USCIS Decision Received (Attorney)", "Case Status", "USCIS decision received", "USCIS decided case [case.id] ([client.name]): [case.status].", { type: "case_approved", priority: "urgent" }),
  live("case.filed", "attorney", "Case Submitted (Attorney)", "Case Status", "Case submitted to USCIS", "Case [case.id] ([client.name]) was submitted to USCIS.", { type: "petition_filed", priority: "high" }),
  live("case.filed", "team_lead", "Case Submitted (Team Lead)", "Case Status", "Case submitted to USCIS", "Case [case.id] ([client.name]) was submitted to USCIS.", { type: "petition_filed", priority: "high" }),

  // ── Closed / reopened / escalated ────────────────────────────────────
  live("case.closed", "admin", "Case Closed (Admin)", "Case Status", "Case closed", "Case [case.id] ([client.name]) was closed.", { type: "case_closed" }),
  live("case.closed", "team_lead", "Case Closed (Team Lead)", "Case Status", "Case closed", "Case [case.id] ([client.name]) was closed.", { type: "case_closed" }),
  live("case.reopened", "case_manager", "Case Reopened (Case Manager)", "Case Status", "Case reopened", "Case [case.id] ([client.name]) was reopened.", { type: "case_reopened", priority: "high" }),
  live("case.reopened", "attorney", "Case Reopened (Attorney)", "Case Status", "Case reopened", "Case [case.id] ([client.name]) was reopened.", { type: "case_reopened", priority: "high" }),
  live("case.escalated", "team_lead", "Case Escalated (Team Lead)", "Case Status", "Case escalated", "Case [case.id] ([client.name]) breached its deadline and needs attention.", { type: "workflow_sla_breached", priority: "urgent" }),
  live("case.escalated", "admin", "Case Escalated (Admin)", "Case Status", "Case escalated", "Case [case.id] ([client.name]) breached its deadline and needs attention.", { type: "workflow_sla_breached", priority: "urgent" }),

  // ── Super Admin: critical/system alerts only ─────────────────────────
  live("case.escalated", "super_admin", "Critical Case / SLA Breach (Super Admin)", "System", "Critical: case deadline breached", "Case [case.id] ([client.name]) breached its deadline.", { type: "workflow_sla_breached", priority: "urgent", groups: ["Client", "Case"] }),
  live("system.email_failed", "super_admin", "Failed Email Delivery (Super Admin)", "System", "Email delivery failed", "An email could not be delivered: [case.details]", { type: "general", priority: "high", groups: ["Case"] }),
  live("system.account_locked", "super_admin", "Account Locked After Failed Logins (Super Admin)", "System", "Security: account locked", "[recipient.name]'s account was locked after repeated failed logins.", { type: "general", priority: "high", groups: ["Case"] }),

  // ── Already notified by existing code; listed so the email can be customized
  live("lead.created", "admin", "New Lead / Consultation Request (Admin)", "Lead", "New lead", "[client.name] - [case.visa_type]", { type: "lead_created", hidden: true, emailKey: "quiz-lead-internal" }),
  live("lead.approved", "admin", "Lead Approved (Admin)", "Lead", "Lead approved", "[client.name] was approved as a lead.", { type: "lead_approved" }),
  live("attorney.feedback", "case_manager", "Attorney Comment / Question (Case Manager)", "Attorney", "Attorney feedback", "[attorney.name] left a comment on case [case.id].", { type: "attorney_feedback", priority: "high" }),
  live("attorney.feedback", "attorney", "Staff Reply to Attorney (Attorney)", "Attorney", "New message from the case team", "The case team replied on case [case.id].", { type: "attorney_feedback", priority: "high" }),
];

module.exports = { AUDIENCES, AUDIENCE_LABEL, EVENT_TRIGGERS };
