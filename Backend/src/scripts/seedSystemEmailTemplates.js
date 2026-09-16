// §5.6.3 system email template seed. Idempotent — only creates rows for
// systemKeys not already present, safe to run repeatedly (e.g. on every
// boot, guarded by an emptiness check — see server.js).
const EmailTemplate = require("../models/EmailTemplate");

const SYSTEM_TEMPLATES = [
  { systemKey: "case_assignment", name: "Case Assignment Notification", subject: "You've been assigned a new case", body: "A new case has been assigned to you: {{case.caseNumber}}.", category: "system" },
  { systemKey: "questionnaire_invitation", name: "Questionnaire Invitation", subject: "Please complete your intake questionnaire", body: "Please complete your questionnaire at {{portal.link}}.", category: "system" },
  { systemKey: "invoice_notification", name: "Invoice Notification", subject: "A new invoice is ready", body: "A new invoice for {{invoice.amount}} is ready for your review.", category: "system" },
  { systemKey: "staff_invitation", name: "Staff Invitation", subject: "You've been invited to join the firm's team", body: "See modules/email/templates/staff-invitation.js for the live template — this row is a catalog/editable-subject entry only.", category: "system" },
  { systemKey: "password_reset", name: "Password Reset (locked)", subject: "Reset your password", body: "See modules/email/templates/password-reset.js — not editable.", category: "system" },
  { systemKey: "document_expiry_reminder", name: "Document Expiry Reminder", subject: "A document is expiring soon", body: "{{document.name}} expires on {{document.expiryDate}}.", category: "system" },
];

async function seedSystemEmailTemplates() {
  const existingCount = await EmailTemplate.countDocuments({ isSystem: true });
  if (existingCount > 0) return { seeded: 0, skipped: true };
  await EmailTemplate.insertMany(SYSTEM_TEMPLATES.map((t) => ({ ...t, isSystem: true })));
  return { seeded: SYSTEM_TEMPLATES.length, skipped: false };
}

module.exports = { seedSystemEmailTemplates, SYSTEM_TEMPLATES };
