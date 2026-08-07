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
};

// The transport/provider (SMTP today, swappable via EMAIL_PROVIDER) is fully
// abstracted behind providers.getProvider().send()/isConfigured() — nothing
// below this line knows or cares which provider is in use.
function isConfigured() {
  return getProvider().isConfigured();
}

function wrapHtml(subjectText, lines = []) {
  const paragraphs = lines.map((line) => `<p style="margin:0 0 12px;">${line}</p>`).join("");
  return `<!doctype html>
<html>
  <body style="font-family:Arial,Helvetica,sans-serif;background:#f4f6f8;padding:24px;margin:0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="background:#0f766e;padding:20px 28px;">
                <span style="color:#ffffff;font-size:16px;font-weight:700;">Immigration CRM</span>
              </td>
            </tr>
            <tr>
              <td style="padding:28px;color:#1f2937;font-size:14px;line-height:1.6;">
                <h2 style="margin:0 0 16px;font-size:18px;color:#111827;">${subjectText}</h2>
                ${paragraphs}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;background:#f8fafc;color:#94a3b8;font-size:12px;">
                This is an automated message from the Immigration CRM platform.
              </td>
            </tr>
          </table>
        </td>
      </tr>
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
