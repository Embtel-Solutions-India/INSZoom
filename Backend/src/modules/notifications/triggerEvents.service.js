// Fires the event-based triggers (modules/email/eventTriggers.catalog.js).
//
//   call site:   triggerEvents.emit("rfe.received", { caseId, actor, data, covered })
//   dispatcher:  every available trigger for that event (one per audience)
//                  -> resolve that audience's users from the live case
//                  -> in-app + socket + browser push (+ email only if an admin
//                     has ACTIVATED a customized template for the trigger)
//
// It is deliberately a "gap filler", not a second notification system:
//   * `covered` names audiences the call site's EXISTING code already notifies
//     ({ client: { notified: true, emailed: true } }). For those, no second
//     in-app/push notification is ever created - at most the customized email
//     is sent if the existing code did not already email them.
//   * a user is never notified twice by one emit (e.g. someone who is both
//     case manager and team lead), and the actor is never notified of their
//     own action.
//   * emit() never throws and never blocks the caller's business logic.
const User = require("../../models/User");
const logger = require("../../utils/logger");
const triggers = require("../email/emailTriggers.registry");
const registry = require("../email/emailVariables.registry");
const customization = require("../email/emailCustomization.service");
const emailPolicy = require("../email/emailPolicy");

const env = require("../../config/env");

const idOf = (value) => String(value?._id || value || "");

// In-app notification link (relative to the recipient's own portal). Every path
// here must be a real route in that portal (checked by tests/emailLinks.test.js).
const PATH_OVERRIDES = {
  "attorney.removed": () => "/dashboard",              // the case is no longer theirs
  "lead.approved": () => "/leads",
  "lead.created": () => "/leads",
  "attorney.feedback:attorney": (caseId) => `/messages/${caseId}`,
  "system.email_failed": () => "/dashboard",
  "system.account_locked": () => "/dashboard",
};
const linkFor = (trigger, caseId) => {
  const override = PATH_OVERRIDES[trigger.key] || PATH_OVERRIDES[trigger.event];
  if (override) return override(caseId);
  if (!caseId) return "/dashboard";
  if (trigger.audience === "client") return "/dashboard";
  if (trigger.audience === "attorney") return `/cases/${caseId}`;
  return `/crm-cases/${caseId}`;
};

// Absolute version for email buttons: the right portal's origin + that path.
const trimSlash = (url) => String(url || "").replace(/\/+$/, "");
function portalLinkFor(trigger, caseId) {
  const path = linkFor(trigger, caseId);
  if (trigger.audience === "client") return `${trimSlash(env.clientUrl)}${path}`;
  if (trigger.audience === "attorney") return `${trimSlash(process.env.ATTORNEY_PORTAL_URL || "http://localhost:5174")}${path}`;
  return `${trimSlash(process.env.ADMIN_PORTAL_URL || "http://localhost:3002")}${path}`;
}

// Users for an audience. Case-scoped audiences come from the loaded case
// context; admin / super_admin are role-wide by nature.
async function resolveAudienceUsers(audience, ctx, onlyIds) {
  // A call site can pin an audience to specific users (e.g. only the attorney
  // who was just assigned/removed, not every attorney on the case).
  if (Array.isArray(onlyIds)) {
    if (!onlyIds.length) return [];
    return User.find({ _id: { $in: onlyIds }, isActive: { $ne: false } }).select("_id email role name displayName isDemoData +password").lean();
  }
  if (audience === "admin" || audience === "super_admin") {
    return User.find({ role: audience, isActive: { $ne: false } }).select("_id email role name displayName isDemoData +password").lean();
  }
  const ids = ctx.people?.[audience] || [];
  if (!ids.length) return [];
  return User.find({ _id: { $in: ids }, isActive: { $ne: false } }).select("_id email role name displayName isDemoData +password").lean();
}

// Should this person be EMAILED (in-app + push are separate and always sent)?
//   yes when an admin activated a template, or the trigger emails automatically
//   (emailPolicy.js) - unless an admin switched the email off, or:
//   - the case / account is demo data, or the address is unusable (placeholder domain)
//   - a client who has not set a password yet (the invitation email is their one email)
function emailDecision(trigger, user, custom, ctx) {
  if (custom && custom.sendEmail === false) return { send: false, reason: "disabled_by_admin" };
  if (!(custom || trigger.emailAuto)) return { send: false, reason: "not_automatic" };
  if (user.isDemoData || ctx.isDemoData) return { send: false, reason: "demo_data" };
  if (!user.email || emailPolicy.undeliverableReason(user.email)) return { send: false, reason: "undeliverable_address" };
  if (trigger.audience === "client" && !user.password) return { send: false, reason: "account_not_activated" };
  return { send: true };
}

async function deliver(trigger, user, { ctx, caseId, actor, data, covered, req }) {
  const notificationService = require("./notification.service");
  const emailService = require("../email/email.service");

  const recipientName = user.name || user.displayName || "";
  const mergedData = { recipientName, portalLink: portalLinkFor(trigger, caseId), ...data };
  const liveCtx = { ...ctx, data: mergedData };
  // Hidden duplicates customize their email through the built-in entry (emailKey).
  const emailKey = trigger.emailKey || trigger.key;
  const custom = await customization.findActive(emailKey).catch(() => null);
  // The existing code already sent this audience an email for this event.
  const emailAlreadySent = Boolean(covered?.emailed);
  const decision = emailDecision(trigger, user, custom, ctx);
  const emailWanted = decision.send && !emailAlreadySent;

  const title = registry.substitute(trigger.push.title, liveCtx, { escape: false });
  const message = registry.substitute(trigger.push.message, liveCtx, { escape: false });

  if (covered?.notified) {
    // The existing code already sent this audience an alert; only add the
    // customized email if one is active and the existing code did not email them.
    if (emailWanted) {
      await emailService.sendTemplateEmail(emailKey, {
        to: user.email, data: mergedData, caseId, userId: user._id, triggeredBy: actor?._id, recipientRole: user.role,
      });
    }
    return "email_only";
  }

  await notificationService.createNotification({
    userId: user._id,
    recipientRole: user.role,
    caseId,
    type: trigger.type,
    category: "case",
    title,
    message,
    link: linkFor(trigger, caseId),
    priority: trigger.priority,
    source: "shared",
    channels: ["in_app", "socket", "push", ...(emailWanted ? ["email"] : [])],
    ...(emailWanted ? { emailTemplate: emailKey, emailData: mergedData } : {}),
    metadata: { triggerKey: trigger.key, event: trigger.event },
  }, actor, req);
  return "notified";
}

// Same event for the same case within this window is treated as one (a retried
// request or two code paths reporting the same moment must not double-notify).
const RECENT_MS = 60 * 1000;
const recent = new Map();
function seenRecently(event, caseId) {
  const now = Date.now();
  for (const [key, at] of recent) if (now - at > RECENT_MS) recent.delete(key);
  const key = `${event}:${caseId || ""}`;
  if (recent.has(key)) return true;
  recent.set(key, now);
  return false;
}

async function emit(event, { caseId, actor, data = {}, covered = {}, recipients = {}, skipUserIds = [], req } = {}) {
  try {
    const defs = triggers.forEvent(event);
    if (!defs.length) return { event, delivered: 0 };

    const ctx = await customization.buildContext({ data, caseId });
    if ((caseId || event.startsWith("system.")) && seenRecently(event, caseId ? String(caseId) : "system")) return { event, delivered: 0, deduped: true };
    const handled = new Set([...(actor ? [idOf(actor)] : []), ...skipUserIds.map(idOf)]); // actor + already-notified users are skipped; nobody twice
    let delivered = 0;

    for (const trigger of defs) {
      const users = await resolveAudienceUsers(trigger.audience, ctx, recipients[trigger.audience]);
      for (const user of users) {
        const userId = idOf(user);
        if (handled.has(userId)) continue;
        handled.add(userId);
        try {
          await deliver(trigger, user, { ctx, caseId, actor, data, covered: covered[trigger.audience], req });
          delivered += 1;
        } catch (error) {
          logger.error("trigger_event_delivery_failed", { event, trigger: trigger.key, userId, error: error.message });
        }
      }
    }
    return { event, delivered };
  } catch (error) {
    logger.error("trigger_event_emit_failed", { event, caseId: caseId && String(caseId), error: error.message });
    return { event, delivered: 0, error: error.message };
  }
}

// Fire-and-forget for call sites that must not wait on notification work.
function emitInBackground(event, options) {
  setImmediate(() => { emit(event, options).catch(() => null); });
}

module.exports = { emit, emitInBackground, resolveAudienceUsers, linkFor, portalLinkFor };
