const EmailLog = require("../../models/EmailLog");
const { getProvider } = require("./providers");

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
          <td style="background:linear-gradient(135deg,#0f766e 0%,#14b8a6 100%);padding:28px 36px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="color:#ffffff;font-size:20px;font-weight:800;letter-spacing:-0.5px;">BAIS</span>
                  <span style="color:#ccfbf1;font-size:12px;font-weight:500;margin-left:8px;letter-spacing:1.5px;text-transform:uppercase;">Immigration Portal</span>
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
              This is an automated message from <strong>BAIS Immigration Portal</strong>. Please do not reply to this email.<br>
              &copy; ${year} Bay Area Immigration Services. All rights reserved.
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
async function sendTemplateEmail(templateKey, { to, cc, data = {}, caseId, userId, triggeredBy, source = "shared", attachments } = {}) {
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown email template: ${templateKey}`);
  if (!to) return { skipped: true, reason: "missing_recipient" };

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
