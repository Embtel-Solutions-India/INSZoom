const EmailLog = require("../../models/EmailLog");
const { getProvider } = require("./providers");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const { layoutHtml, renderCustom } = require("./emailRenderer");
const customization = require("./emailCustomization.service");
const triggerRegistry = require("./emailTriggers.registry");

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
  "staff-credentials": "team_member",
  "attorney-assignment": "attorney",
  "client-portal-invitation": "client",
  "password-reset": "client",
  "family-beneficiary-invitation": "client",
  "quiz-lead-internal": "team_member",
  "consultation-confirmation": "client",
  "consultation-reschedule": "client",
  "consultation-cancel": "client",
  "consultation-host-notify": "team_member",
  "lead-approved": "client",
  "lead-rejected": "client",
  "document-requested": "client",
  "filing-submitted": "client",
  "receipt-received": "client",
  "rfe-received": "client",
  "case-approved": "client",
  "case-denied": "client",
  "case-stage-changed": "client",
  "case-manager-assigned": "team_member",
  "case-manager-reassigned": "team_member",
  "case-closed": "client",
  "additional-info-requested": "client",
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
  if (TEMPLATE_AUDIENCE[templateKey]) return TEMPLATE_AUDIENCE[templateKey];
  // Event-based triggers have no entry above - derive from their audience.
  const audience = triggerRegistry.getTrigger(templateKey)?.audience;
  return audience === "attorney" ? "attorney" : audience && audience !== "client" ? "team_member" : "client";
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
  "staff-credentials": require("./templates/staff-credentials"),
  "attorney-assignment": require("./templates/attorney-assignment"),
  "client-portal-invitation": require("./templates/client-portal-invitation"),
  "password-reset": require("./templates/password-reset"),
  "family-beneficiary-invitation": require("./templates/family-beneficiary-invitation"),
  "quiz-lead-internal": require("./templates/quiz-lead-internal"),
  "consultation-confirmation": require("./templates/consultation-confirmation"),
  "consultation-reschedule": require("./templates/consultation-reschedule"),
  "consultation-cancel": require("./templates/consultation-cancel"),
  "consultation-host-notify": require("./templates/consultation-host-notify"),
  "lead-approved": require("./templates/lead-approved"),
  "lead-rejected": require("./templates/lead-rejected"),
  "document-requested": require("./templates/document-requested"),
  "filing-submitted": require("./templates/filing-submitted"),
  "receipt-received": require("./templates/receipt-received"),
  "rfe-received": require("./templates/rfe-received"),
  "case-approved": require("./templates/case-approved"),
  "case-denied": require("./templates/case-denied"),
  "case-stage-changed": require("./templates/case-stage-changed"),
  "case-manager-assigned": require("./templates/case-manager-assigned"),
  "case-manager-reassigned": require("./templates/case-manager-reassigned"),
  "case-closed": require("./templates/case-closed"),
  "additional-info-requested": require("./templates/additional-info-requested"),
};

// The transport/provider (SMTP today, swappable via EMAIL_PROVIDER) is fully
// abstracted behind providers.getProvider().send()/isConfigured() — nothing
// below this line knows or cares which provider is in use.
function isConfigured() {
  return getProvider().isConfigured();
}

function wrapHtml(subjectText, lines = []) {
  const paragraphs = lines
    .map((line) => `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7;">${line}</p>`)
    .join("");
  return layoutHtml({ title: subjectText, heading: subjectText, innerHtml: paragraphs });
}

/**
 * Persist + dispatch an EmailLog entry through the active provider. Shared
 * by sendTemplateEmail() below; every send attempt is logged regardless of
 * whether a provider is configured (dev-safe: records "skipped" instead of
 * throwing so callers never need try/catch around email sends).
 */
async function dispatch({ templateKey, to, cc, bcc, subject, html, text, data, caseId, userId, triggeredBy, source = "shared", attachments }) {
  const log = await EmailLog.create({ templateKey, to, cc, bcc, subject, status: "queued", caseId, userId, triggeredBy, data, source });

  const provider = getProvider();
  if (!provider.isConfigured()) {
    log.status = "skipped";
    log.error = `Email provider "${provider.name}" is not configured`;
    await log.save();
    return { sent: false, skipped: true, log };
  }

  try {
    log.attempts += 1;
    const result = await provider.send({ to, cc, bcc, subject, html, text, attachments });
    log.status = "sent";
    log.sentAt = new Date();
    log.providerMessageId = result?.messageId;
    await log.save();
    return { sent: true, log };
  } catch (error) {
    log.status = "failed";
    log.error = error.message;
    await log.save();
    // Super Admin is told about delivery failures - but never about a failure
    // of the alert itself (that would loop), and never for test sends.
    if (templateKey !== "custom-test" && !String(templateKey).startsWith("system.")) {
      require("../notifications/triggerEvents.service").emitInBackground("system.email_failed", {
        data: { details: `${templateKey} to ${to} (${error.message})` },
      });
    }
    return { sent: false, error, log };
  }
}

// Admin-customized version of a built-in email (Email Template
// Customization page). Returns null - meaning "send the built-in email
// exactly as before" - when there is no active customization for this key,
// the key is locked, or ANYTHING goes wrong while resolving/rendering it:
// customization is an enhancement and must never be able to block a send.
async function resolveCustomization(templateKey, { to, data, caseId }) {
  try {
    const trigger = triggerRegistry.getTrigger(templateKey);
    if (!trigger || trigger.locked) return null;
    const custom = await customization.findActive(templateKey);
    if (!custom) return null;
    const ctx = await customization.buildContext({ data, caseId });
    const rendered = renderCustom(custom, ctx);
    const recipients = await customization.applyRecipientRules(custom, to, ctx, { toFromRules: Boolean(trigger.builtIn) });
    return { ...rendered, recipients, customTemplateId: custom._id };
  } catch (error) {
    logger.error("email_customization_failed_fell_back_to_default", { templateKey, error: error.message });
    return null;
  }
}

/**
 * Send an email using a registered template. This is the primary entry
 * point for the rest of the app — no controller/service should ever build
 * HTML or talk to a provider directly.
 */
async function sendTemplateEmail(templateKey, { to, cc, data = {}, caseId, userId, triggeredBy, source = "shared", attachments, recipientRole } = {}) {
  const builtIn = TEMPLATES[templateKey];
  const eventTrigger = !builtIn ? triggerRegistry.getTrigger(templateKey) : null;
  if (!builtIn && !eventTrigger) throw new Error(`Unknown email template: ${templateKey}`);
  if (!to) return { skipped: true, reason: "missing_recipient" };
  // Event-based triggers have no built-in email: they only ever send once an
  // admin has activated a customized template for them.
  const template = builtIn || { subject: () => eventTrigger.label, bodyLines: () => [] };

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

  const custom = await resolveCustomization(templateKey, { to, data, caseId });
  if (custom) {
    const extraCc = [...new Set([...(cc ? [].concat(cc) : []), ...custom.recipients.cc])];
    return dispatch({
      templateKey, to: custom.recipients.to.join(", "), cc: extraCc, bcc: custom.recipients.bcc,
      subject: custom.subject, html: custom.html, text: custom.text, data, caseId, userId, triggeredBy, source, attachments,
    });
  }

  if (!builtIn) return { skipped: true, reason: "no_active_template" };

  const subject = template.subject(data);
  const lines = template.bodyLines(data);
  const html = wrapHtml(subject, lines);
  const text = lines.join("\n\n");

  return dispatch({ templateKey, to, cc, subject, html, text, data, caseId, userId, triggeredBy, source, attachments });
}

module.exports = {
  sendTemplateEmail,
  isConfigured,
  dispatch,
  wrapHtml,
  TEMPLATES,
  TEMPLATE_AUDIENCE,
};
