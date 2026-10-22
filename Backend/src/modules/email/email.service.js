const EmailLog = require("../../models/EmailLog");
const { getProvider } = require("./providers");
const env = require("../../config/env");
const logger = require("../../utils/logger");
const { layoutHtml, renderCustom, adminLoginText } = require("./emailRenderer");
const customization = require("./emailCustomization.service");
const triggerRegistry = require("./emailTriggers.registry");
const emailPolicy = require("./emailPolicy");
const { portalUrl, productionizeLinks, confineToPortal } = require("./portalUrls");
const caseAudience = require("../notifications/caseAudience");

// Dev/testing-phase audience gate (see env.js's emailSuppressStaffAndAttorney
// comment for the why). Every template's INTRINSIC recipient — the person
// the template was written to address, not a guess — classified once here.
// "password-reset" and "consultation-host-notify" are the two templates
// actually reused across more than one audience in practice; their real call
// sites pass an explicit `recipientRole` (see auth.controller.js's
// forgotPassword, consultation.service.js's notifyHost,
// notification.service.js's dispatchEmailChannel) which overrides this
// static table whenever it's known — see resolveAudience() below.
// still sent while EMAIL_SUPPRESS_ALL is on: a password reset the person asked for themselves
const SUPPRESS_ALL_EXEMPT = new Set(["password-reset"]);
// Everyone who works in the Admin portal ("team_member" is the generic internal-team marker some call sites pass instead of a User.role).
const STAFF_ROLES = ["super_admin", "admin", "team_lead", "case_manager", "paralegal", "finance", "hr", "team_member"];
const TEMPLATE_AUDIENCE = {
  "case-created-client": "client",
  "case-created-team-lead": "team_member",
  "case-assigned-case-manager": "team_member",
  "client-intake-submitted-case-manager": "team_member",
  "questionnaire-progress-saved": "team_member",
  "form-pipeline-alert": "team_member",
  "form-pipeline-success": "team_member",
  "form-pipeline-held": "team_member",
  "form-pipeline-digest": "team_member",
  "task-assigned": "team_member",
  "task-self-created": "team_member",
  "task-deadline-reminder": "team_member",
  "task-deadline-creator": "team_member",
  "task-overdue": "team_member",
  "task-overdue-creator": "team_member",
  "employee-case-invitation": "client",
  "employee-access-restored": "client",
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
  "case-manager-assigned": "client", // tells the client who their case manager is - never gets the staff "Log in to Admin" button
  "case-manager-reassigned": "client",
  "case-closed": "client",
  "premium-processing-upgraded": "client",
  "additional-info-requested": "client",
  "new-message-received": "client",
  "questionnaire-submitted-team": "team_member",
  "client-message-team-alert": "team_member",
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
  "employee-access-restored": require("./templates/employee-access-restored"),
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
  "premium-processing-upgraded": require("./templates/premium-processing-upgraded"),
  "additional-info-requested": require("./templates/additional-info-requested"),
  "new-message-received": require("./templates/new-message-received"),
  "questionnaire-progress-saved": require("./templates/questionnaire-progress-saved"),
  "questionnaire-submitted-team": require("./templates/questionnaire-submitted-team"),
  "client-message-team-alert": require("./templates/client-message-team-alert"),
  "form-pipeline-alert": require("./templates/form-pipeline-alert"),
  "form-pipeline-success": require("./templates/form-pipeline-success"),
  "form-pipeline-held": require("./templates/form-pipeline-held"),
  "form-pipeline-digest": require("./templates/form-pipeline-digest"),
  "task-assigned": require("./templates/task-alerts").assigned,
  "task-self-created": require("./templates/task-alerts").selfCreated,
  "task-deadline-reminder": require("./templates/task-alerts").dueSoon,
  "task-deadline-creator": require("./templates/task-alerts").dueSoonCreator,
  "task-overdue": require("./templates/task-alerts").overdue,
  "task-overdue-creator": require("./templates/task-alerts").overdueCreator,
};

// The transport/provider (SMTP today, swappable via EMAIL_PROVIDER) is fully
// abstracted behind providers.getProvider().send()/isConfigured() — nothing
// below this line knows or cares which provider is in use.
function isConfigured() {
  return getProvider().isConfigured();
}

function wrapHtml(subjectText, lines = [], { adminLogin = false } = {}) {
  const paragraphs = lines
    .map((line) => `<p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.7;">${line}</p>`)
    .join("");
  return layoutHtml({ title: subjectText, heading: subjectText, innerHtml: paragraphs, adminLogin });
}

/**
 * Persist + dispatch an EmailLog entry through the active provider. Shared
 * by sendTemplateEmail() below; every send attempt is logged regardless of
 * whether a provider is configured (dev-safe: records "skipped" instead of
 * throwing so callers never need try/catch around email sends).
 */
async function dispatch({ templateKey, to, cc, bcc, subject, html, text, data, caseId, userId, triggeredBy, source = "shared", attachments }) {
  // Emails only ever carry production links: a localhost address from any call site becomes the real portal address.
  subject = productionizeLinks(subject); html = productionizeLinks(html); text = productionizeLinks(text);
  // Master switch (env.emailSuppressAll): nothing goes out to anyone - logged as skipped, never handed to the provider
  if (env.emailSuppressAll && !SUPPRESS_ALL_EXEMPT.has(templateKey)) {
    const log = await EmailLog.create({ templateKey, to, cc, bcc, subject, status: "skipped", caseId, userId, triggeredBy, data, source, error: "Suppressed: all outbound email is switched off (EMAIL_SUPPRESS_ALL)" });
    return { sent: false, skipped: true, reason: "all_email_suppressed", log };
  }
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

// Where an email's button/link should land when the call site did not supply
// one: the portal the RECIPIENT actually uses, deep-linked to the case where
// that portal has a case page. (Several built-in emails fall back to "#" in
// their own text when no link is passed - this makes sure they never do.)
const trimSlash = (url) => String(url || "").replace(/\/+$/, "");
const PORTAL_OF_AUDIENCE = {
  client: () => `${portalUrl("client")}/dashboard`,
  attorney: (caseId) => `${portalUrl("attorney")}${caseId ? `/cases/${caseId}` : "/dashboard"}`,
  staff: (caseId) => `${portalUrl("admin")}${caseId ? `/crm-cases/${caseId}` : "/dashboard"}`,
};
// Same answer as resolveAudience() (one rule for "which portal is this person's"), as a PORTAL_OF_AUDIENCE key.
function defaultPortalLink(templateKey, recipientRole, caseId) {
  const audience = resolveAudience(templateKey, recipientRole);
  return PORTAL_OF_AUDIENCE[audience === "team_member" ? "staff" : audience](caseId);
}

// Admin-customized version of a built-in email (Email Template
// Customization page). Returns null - meaning "send the built-in email
// exactly as before" - when there is no active customization for this key,
// the key is locked, or ANYTHING goes wrong while resolving/rendering it:
// customization is an enhancement and must never be able to block a send.
async function resolveCustomization(templateKey, { to, data, caseId, adminLogin = false }) {
  try {
    const trigger = triggerRegistry.getTrigger(templateKey);
    if (!trigger || trigger.locked) return null;
    const active = await customization.findActive(templateKey);
    // An admin switched this email off: nothing is emailed (alerts are unaffected).
    if (active && active.sendEmail === false) return { suppressed: true };
    let custom = active;
    if (!custom && !trigger.builtIn && trigger.emailAuto) {
      // Event email that is sent by default: its professionally written default wording.
      const defaults = customization.defaultContentFor(templateKey, TEMPLATES);
      if (defaults) custom = { _id: "default", subject: defaults.subject, heading: defaults.heading, body: defaults.body, recipients: {} };
    }
    if (!custom) return null;
    const ctx = await customization.buildContext({ data, caseId });
    const rendered = renderCustom(custom, ctx, { adminLogin });
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
  data = { ...data, portalLink: data.portalLink || defaultPortalLink(templateKey, recipientRole, caseId) };
  // [system.set_password_link] / [system.login_link]: the exact pages the client's email button opens.
  const clientOrigin = portalUrl("client");
  if (templateKey === "client-portal-invitation" && !data.setPasswordLink && data.token) data = { ...data, setPasswordLink: `${clientOrigin}/accept-invite?token=${data.token}` };
  if (templateKey === "case-created-client" && !data.loginLink) data = { ...data, loginLink: `${clientOrigin}/login` };
  const builtIn = TEMPLATES[templateKey];
  const eventTrigger = !builtIn ? triggerRegistry.getTrigger(templateKey) : null;
  if (!builtIn && !eventTrigger) throw new Error(`Unknown email template: ${templateKey}`);
  if (!to) return { skipped: true, reason: "missing_recipient" };
  // Event-based triggers have no built-in email: they send their default wording
  // when the trigger is set to email automatically (emailPolicy.js), or an
  // admin's activated template - never anything else.
  const template = builtIn || { subject: () => eventTrigger.label, bodyLines: () => [] };

  // A skipped send is still logged, so "why didn't X get an email?" is answerable.
  const skip = async (reason, message) => {
    const log = await EmailLog.create({ templateKey, to, cc, subject: template.subject(data), status: "skipped", caseId, userId, triggeredBy, data, source, error: `Not sent: ${message}` }).catch(() => null);
    return { sent: false, skipped: true, reason, log };
  };

  // Guards for EVERY email (see emailPolicy.js): never a malformed or placeholder
  // address, and never the same email to the same person for the same case twice
  // in a short window (retried requests, bursts). Credential/invite mails are exempt.
  const badAddress = emailPolicy.undeliverableReason(to);
  if (badAddress) return skip(badAddress, badAddress === "invalid_address" ? "invalid email address" : "placeholder/test email domain");
  // Internal staff outside this case's team (another team lead / case manager, any admin / super admin) never get the case's emails.
  if (caseId && !emailPolicy.NEVER_THROTTLED.has(templateKey) && !triggerRegistry.getTrigger(templateKey)?.locked) {
    const outside = await caseAudience.isOutsideCaseTeam({ userId, email: to, caseId }).catch(() => false);
    if (outside) return skip("not_case_team", "the recipient is not on this case's team");
  }
  if (caseId && !emailPolicy.NEVER_THROTTLED.has(templateKey)) {
    const windowMs = triggerRegistry.getTrigger(templateKey)?.cooldownMs || emailPolicy.DEFAULT_COOLDOWN_MS;
    const repeated = await emailPolicy.recentlySent({ templateKey, to, caseId, windowMs }).catch(() => false);
    if (repeated) return skip("repeat", "the same email was already sent for this case a moment ago");
  }

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

  // Internal staff (case manager, team lead, admin, super admin) always get a "Log in to Admin" button; security emails stay as they are.
  const audience = resolveAudience(templateKey, recipientRole);
  const locked = Boolean(triggerRegistry.getTrigger(templateKey)?.locked);
  const adminLogin = audience === "team_member" && !locked;
  // Client emails link only to the Client portal, internal-team emails only to Admin, attorney emails only to the Attorney portal.
  // Locked security emails (credentials / password reset) already build their own exact link.
  const ownPortal = audience === "team_member" ? "admin" : audience;
  const ownLanding = defaultPortalLink(templateKey, recipientRole, caseId);
  const confine = (content) => (locked ? content : confineToPortal(productionizeLinks(content), ownPortal, ownLanding));
  const custom = await resolveCustomization(templateKey, { to, data, caseId, adminLogin });
  if (custom?.suppressed) return skip("disabled_by_admin", "This email is switched off on the Email Templates page");
  if (custom) {
    const deliverable = (list) => list.filter((address) => !emailPolicy.undeliverableReason(address));
    const finalTo = deliverable(custom.recipients.to);
    if (!finalTo.length) return skip("undeliverable_address", "No deliverable recipient address");
    const extraCc = deliverable([...new Set([...(cc ? [].concat(cc) : []), ...custom.recipients.cc])]);
    return dispatch({
      templateKey, to: finalTo.join(", "), cc: extraCc, bcc: deliverable(custom.recipients.bcc),
      subject: custom.subject, html: confine(custom.html), text: confine(custom.text), data, caseId, userId, triggeredBy, source, attachments,
    });
  }

  if (!builtIn) return { skipped: true, reason: "no_active_template" };

  const subject = template.subject(data);
  const lines = template.bodyLines(data);
  const html = confine(wrapHtml(subject, lines, { adminLogin }));
  const bodyText = lines.join("\n\n");
  const text = confine([bodyText, adminLogin && adminLoginText(bodyText)].filter(Boolean).join("\n\n"));

  return dispatch({ templateKey, to, cc, subject, html, text, data, caseId, userId, triggeredBy, source, attachments });
}

module.exports = {
  sendTemplateEmail,
  isConfigured,
  dispatch,
  defaultPortalLink,
  wrapHtml,
  TEMPLATES,
  TEMPLATE_AUDIENCE,
};
