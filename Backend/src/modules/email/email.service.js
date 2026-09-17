const EmailLog = require("../../models/EmailLog");
const { getProvider } = require("./providers");
const env = require("../../config/env");

// Dev/testing-phase audience gate (see env.js's emailSuppressStaffAndAttorney
// comment for the why). Every template's INTRINSIC recipient — the person
// the template was written to address, not a guess — classified once here.
// "password-reset" and "consultation-host-notify" are the two templates
// actually reused across more than one audience in practice; their real call
// sites pass an explicit `recipientRole` (see auth.controller.js's
// forgotPassword, consultation.service.js's notifyHost,
// notification.service.js's dispatchEmailChannel) which overrides this
// static table whenever it's known — see resolveAudience() below.
const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager"];
const TEMPLATE_AUDIENCE = {
  "case-created-client": "client",
  "case-created-team-lead": "team_member",
  "case-assigned-case-manager": "team_member",
  "client-intake-submitted-case-manager": "team_member",
  "employee-case-invitation": "client",
  "staff-invitation": "team_member",
  "attorney-assignment": "attorney",
  "client-portal-invitation": "client",
  "password-reset": "client",
  "family-beneficiary-invitation": "client",
  "quiz-lead-confirmation": "client",
  "quiz-lead-internal": "team_member",
  "consultation-confirmation": "client",
  "consultation-reschedule": "client",
  "consultation-cancel": "client",
  "consultation-host-notify": "team_member",
  "lead-approved": "client",
  "lead-rejected": "client",
  "document-rejected": "client",
  "document-requested": "client",
  "signature-required": "client",
  "filing-submitted": "client",
  "receipt-received": "client",
  "rfe-received": "client",
  "case-approved": "client",
  "case-denied": "client",
  "case-stage-changed": "client",
  "payment-required": "client",
  "payment-failed": "client",
  "case-manager-assigned": "team_member",
  "case-manager-reassigned": "team_member",
  "case-closed": "client",
  "interview-scheduled": "client",
  "biometrics-scheduled": "client",
  "questionnaire-assigned": "client",
  "additional-info-requested": "client",
  "case-on-hold": "client",
};

// recipientRole (an actual User.role, when the caller has it handy) always
// wins over the static table above — it reflects who this particular send
// is actually going to, not just who the template is usually for.
function resolveAudience(templateKey, recipientRole) {
  if (recipientRole) {
    if (recipientRole === "attorney") return "attorney";
    if (STAFF_ROLES.includes(recipientRole)) return "team_member";
    return "client";
  }
  return TEMPLATE_AUDIENCE[templateKey] || "client";
}

// Reusable template registry — one file per template under ./templates.
// Adding a new email anywhere in the app means adding a template file here
// and calling sendTemplateEmail(key, ...) at the call site. No inline/hardcoded
// email content should ever live in a controller or service.
const TEMPLATES = {
  "case-created-client": require("./templates/case-created-client"),
  "case-created-team-lead": require("./templates/case-created-team-lead"),
  "case-assigned-case-manager": require("./templates/case-assigned-case-manager"),
  "client-intake-submitted-case-manager": require("./templates/client-intake-submitted-case-manager"),
  "employee-case-invitation": require("./templates/employee-case-invitation"),
  "staff-invitation": require("./templates/staff-invitation"),
  "attorney-assignment": require("./templates/attorney-assignment"),
  "client-portal-invitation": require("./templates/client-portal-invitation"),
  "password-reset": require("./templates/password-reset"),
  "family-beneficiary-invitation": require("./templates/family-beneficiary-invitation"),
  "quiz-lead-confirmation": require("./templates/quiz-lead-confirmation"),
  "quiz-lead-internal": require("./templates/quiz-lead-internal"),
  "consultation-confirmation": require("./templates/consultation-confirmation"),
  "consultation-reschedule": require("./templates/consultation-reschedule"),
  "consultation-cancel": require("./templates/consultation-cancel"),
  "consultation-host-notify": require("./templates/consultation-host-notify"),
  "lead-approved": require("./templates/lead-approved"),
  "lead-rejected": require("./templates/lead-rejected"),
  "document-rejected": require("./templates/document-rejected"),
  "document-requested": require("./templates/document-requested"),
  "signature-required": require("./templates/signature-required"),
  "filing-submitted": require("./templates/filing-submitted"),
  "receipt-received": require("./templates/receipt-received"),
  "rfe-received": require("./templates/rfe-received"),
  "case-approved": require("./templates/case-approved"),
  "case-denied": require("./templates/case-denied"),
  "case-stage-changed": require("./templates/case-stage-changed"),
  "payment-required": require("./templates/payment-required"),
  "payment-failed": require("./templates/payment-failed"),
  "case-manager-assigned": require("./templates/case-manager-assigned"),
  "case-manager-reassigned": require("./templates/case-manager-reassigned"),
  "case-closed": require("./templates/case-closed"),
  "interview-scheduled": require("./templates/interview-scheduled"),
  "biometrics-scheduled": require("./templates/biometrics-scheduled"),
  "questionnaire-assigned": require("./templates/questionnaire-assigned"),
  "additional-info-requested": require("./templates/additional-info-requested"),
  "case-on-hold": require("./templates/case-on-hold"),
};

// The transport/provider (SMTP today, swappable via EMAIL_PROVIDER) is fully
// abstracted behind providers.getProvider().send()/isConfigured() — nothing
// below this line knows or cares which provider is in use.
function isConfigured() {
  return getProvider().isConfigured();
}

function wrapHtml(subjectText, lines = []) {
  const year = new Date().getFullYear();
  const paragraphs = lines
    .map((line) => `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7;">${line}</p>`)
    .join("");
  return `<!doctype html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subjectText}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.06);">
        <tr>
          <td style="background:#1e3a5f;padding:28px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">Immiglance</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 36px 28px;">
            <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#111827;line-height:1.3;">${subjectText}</h1>
            ${paragraphs}
          </td>
        </tr>
        <tr><td style="padding:0 36px;"><div style="height:1px;background:#e5e7eb;"></div></td></tr>
        <tr>
          <td style="padding:20px 36px 28px;">
            <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
              This is an automated message from <strong>Immiglance</strong>. Please do not reply to this email.<br>
              &copy; ${year} Immiglance. All rights reserved.
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Persist + dispatch an EmailLog entry through the active provider. Shared
 * by sendTemplateEmail() below; every send attempt is logged regardless of
 * whether a provider is configured (dev-safe: records "skipped" instead of
 * throwing so callers never need try/catch around email sends).
 */
async function dispatch({ templateKey, to, cc, subject, html, text, data, caseId, userId, triggeredBy, source = "shared", attachments }) {
  const log = await EmailLog.create({ templateKey, to, cc, subject, status: "queued", caseId, userId, triggeredBy, data, source });

  const provider = getProvider();
  if (!provider.isConfigured()) {
    log.status = "skipped";
    log.error = `Email provider "${provider.name}" is not configured`;
    await log.save();
    return { sent: false, skipped: true, log };
  }

  try {
    log.attempts += 1;
    const result = await provider.send({ to, cc, subject, html, text, attachments });
    log.status = "sent";
    log.sentAt = new Date();
    log.providerMessageId = result?.messageId;
    await log.save();
    return { sent: true, log };
  } catch (error) {
    log.status = "failed";
    log.error = error.message;
    await log.save();
    return { sent: false, error, log };
  }
}

/**
 * Send an email using a registered template. This is the primary entry
 * point for the rest of the app — no controller/service should ever build
 * HTML or talk to a provider directly.
 */
async function sendTemplateEmail(templateKey, { to, cc, data = {}, caseId, userId, triggeredBy, source = "shared", attachments, recipientRole } = {}) {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown email template: ${templateKey}`);
  if (!to) return { skipped: true, reason: "missing_recipient" };

  // Dev/testing-phase gate — team-member and attorney recipients are
  // suppressed (still logged, never actually dispatched); client recipients
  // are unaffected. Nothing about the template registry, the call site, or
  // the caller's own logic changes — this only intercepts the final
  // provider dispatch. Flip EMAIL_SUPPRESS_STAFF_AND_ATTORNEY=false in
  // Backend/.env when it's time to actually email real staff/attorneys
  // again.
  if (env.emailSuppressStaffAndAttorney) {
    const audience = resolveAudience(templateKey, recipientRole);
    if (audience !== "client") {
      const log = await EmailLog.create({
        templateKey, to, cc, subject: template.subject(data), status: "skipped",
        caseId, userId, triggeredBy, data, source,
        error: `Suppressed: ${audience} recipient (dev/testing phase — see EMAIL_SUPPRESS_STAFF_AND_ATTORNEY)`,
      });
      return { sent: false, skipped: true, reason: "audience_suppressed", audience, log };
    }
  }

  const subject = template.subject(data);
  const lines = template.bodyLines(data);
  const html = wrapHtml(subject, lines);
  const text = lines.join("\n\n");

  return dispatch({ templateKey, to, cc, subject, html, text, data, caseId, userId, triggeredBy, source, attachments });
}

module.exports = {
  sendTemplateEmail,
  isConfigured,
};
