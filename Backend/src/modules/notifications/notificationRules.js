// Business-rule defaults for {priority, channels} by notification `type`,
// derived from the product's event tables (client / case manager / team
// lead / admin / super admin notifications).
//
// This is a FALLBACK ONLY — see resolveNotificationDefaults() below and its
// single call site in notification.service.js's normalizeCreatePayload().
// Existing call sites (32+ across the app) already pass explicit
// priority/channels and are completely unaffected; this table only fills in
// values a caller omitted, so behavior for every existing notification is
// provably unchanged.
//
// A `type` string is sometimes used for both a client-facing and a
// staff-facing event in the source tables (e.g. "case_assigned" appears in
// both the Client table as Normal/In-App and the Case Manager table as
// High/In-App+Push) — since this table is keyed by type, not by
// (type, recipient role), each such type keeps a single entry: the more
// urgent of the two, since it's safer to over-notify than to silently miss
// something time-sensitive.
const TYPE_RULES = {
  // ── Client ──
  account_created: { priority: "medium", channels: ["in_app"] },
  welcome: { priority: "medium", channels: ["email"] },
  case_created: { priority: "medium", channels: ["in_app"] },
  case_assigned: { priority: "high", channels: ["in_app", "push"] },
  case_stage_changed: { priority: "high", channels: ["in_app", "push"] },
  questionnaire_assigned: { priority: "high", channels: ["in_app", "push"] },
  questionnaire_reminder: { priority: "high", channels: ["in_app", "push"] },
  questionnaire_rejected: { priority: "high", channels: ["in_app", "push"] },
  questionnaire_corrections_requested: { priority: "high", channels: ["in_app", "push"] },
  questionnaire_approved: { priority: "medium", channels: ["in_app"] },
  document_requested: { priority: "high", channels: ["in_app", "push"] },
  missing_document_requested: { priority: "high", channels: ["in_app", "push"] },
  document_uploaded: { priority: "medium", channels: ["in_app"] },
  document_approved: { priority: "medium", channels: ["in_app"] },
  document_rejected: { priority: "high", channels: ["in_app", "push"] },
  additional_information_requested: { priority: "high", channels: ["in_app", "push"] },
  petition_draft_completed: { priority: "medium", channels: ["in_app"] },
  petition_filed: { priority: "high", channels: ["in_app", "push", "email"] },
  receipt_number_generated: { priority: "high", channels: ["in_app", "push", "email"] },
  biometric_appointment: { priority: "urgent", channels: ["in_app", "push", "email"] },
  interview_scheduled: { priority: "urgent", channels: ["in_app", "push", "email"] },
  rfe_received: { priority: "urgent", channels: ["in_app", "push", "email"] },
  noid_received: { priority: "urgent", channels: ["in_app", "push", "email"] },
  case_approved: { priority: "urgent", channels: ["in_app", "push", "email"] },
  case_rejected: { priority: "urgent", channels: ["in_app", "push", "email"] },
  payment_due: { priority: "high", channels: ["in_app", "push"] },
  payment_due_soon: { priority: "high", channels: ["in_app", "push"] },
  payment_received: { priority: "medium", channels: ["in_app", "email"] },
  payment_failed: { priority: "urgent", channels: ["in_app", "push", "email"] },
  payment_failure: { priority: "urgent", channels: ["in_app", "push", "email"] },
  appointment_reminder_24h: { priority: "high", channels: ["in_app", "push"] },
  appointment_reminder_1h: { priority: "high", channels: ["in_app", "push"] },
  client_message: { priority: "medium", channels: ["in_app", "push"] },
  message_received: { priority: "medium", channels: ["in_app", "push"] },

  // ── Case manager / team lead / admin / super admin ──
  new_client_registered: { priority: "high", channels: ["in_app", "push"] },
  questionnaire_submitted: { priority: "high", channels: ["in_app", "push"] },
  questionnaire_overdue: { priority: "high", channels: ["in_app", "push"] },
  document_reminder: { priority: "high", channels: ["in_app", "push"] },
  document_overdue: { priority: "high", channels: ["in_app", "push"] },
  new_document_uploaded: { priority: "high", channels: ["in_app", "push"] },
  evidence_review_required: { priority: "high", channels: ["in_app", "push"] },
  petition_ready_for_filing: { priority: "urgent", channels: ["in_app", "push"] },
  petition_ready_for_approval: { priority: "high", channels: ["in_app", "push"] },
  filing_deadline_approaching: { priority: "urgent", channels: ["in_app", "push"] },
  team_case_created: { priority: "medium", channels: ["in_app"] },
  case_reassigned: { priority: "medium", channels: ["in_app"] },
  new_user_registered: { priority: "medium", channels: ["in_app"] },
  appointment_scheduled: { priority: "medium", channels: ["in_app"] },
  new_organization_added: { priority: "medium", channels: ["in_app"] },
  new_admin_created: { priority: "medium", channels: ["in_app"] },
  case_statistics_summary: { priority: "low", channels: ["in_app"] },
  daily_platform_summary: { priority: "low", channels: ["in_app"] },
};

function resolveNotificationDefaults(type) {
  return type ? TYPE_RULES[type] : undefined;
}

module.exports = { TYPE_RULES, resolveNotificationDefaults };
