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

const env = require("../../config/env");

const idOf = (value) => String(value?._id || value || "");

// Where the email's button should land: the right portal, deep-linked to the case.
const trimSlash = (url) => String(url || "").replace(/\/+$/, "");
function portalLinkFor(audience, caseId) {
  if (audience === "client") return `${trimSlash(env.clientUrl)}/dashboard`;
  if (audience === "attorney") return `${trimSlash(process.env.ATTORNEY_PORTAL_URL || "http://localhost:5174")}${caseId ? `/cases/${caseId}` : "/dashboard"}`;
  return `${trimSlash(process.env.ADMIN_PORTAL_URL || "http://localhost:3002")}${caseId ? `/crm-cases/${caseId}` : "/dashboard"}`;
}

const linkFor = (audience, caseId) => {
  if (!caseId) return "/dashboard";
  if (audience === "client") return "/dashboard";
  if (audience === "attorney") return `/cases/${caseId}`;
  return `/crm-cases/${caseId}`;
};

// Users for an audience. Case-scoped audiences come from the loaded case
// context; admin / super_admin are role-wide by nature.
async function resolveAudienceUsers(audience, ctx, onlyIds) {
  // A call site can pin an audience to specific users (e.g. only the attorney
  // who was just assigned/removed, not every attorney on the case).
  if (Array.isArray(onlyIds)) {
    if (!onlyIds.length) return [];
    return User.find({ _id: { $in: onlyIds }, isActive: { $ne: false } }).select("_id email role name displayName").lean();
  }
  if (audience === "admin" || audience === "super_admin") {
    return User.find({ role: audience, isActive: { $ne: false } }).select("_id email role name displayName").lean();
  }
  const ids = ctx.people?.[audience] || [];
  if (!ids.length) return [];
  return User.find({ _id: { $in: ids }, isActive: { $ne: false } }).select("_id email role name displayName").lean();
}

async function deliver(trigger, user, { ctx, caseId, actor, data, covered, req }) {
  const notificationService = require("./notification.service");
  const emailService = require("../email/email.service");

  const recipientName = user.name || user.displayName || "";
  const mergedData = { recipientName, portalLink: portalLinkFor(trigger.audience, caseId), ...data };
  const liveCtx = { ...ctx, data: mergedData };
  // Hidden duplicates customize their email through the built-in entry (emailKey).
  const emailKey = trigger.emailKey || trigger.key;
  const custom = await customization.findActive(emailKey).catch(() => null);
  // The existing code already sent this audience an email for this event.
  const emailAlreadySent = Boolean(covered?.emailed);

  const title = registry.substitute(trigger.push.title, liveCtx, { escape: false });
  const message = registry.substitute(trigger.push.message, liveCtx, { escape: false });

  if (covered?.notified) {
    // The existing code already sent this audience an alert; only add the
    // customized email if one is active and the existing code did not email them.
    if (custom && !emailAlreadySent && user.email) {
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
    link: linkFor(trigger.audience, caseId),
    priority: trigger.priority,
    source: "shared",
    channels: ["in_app", "socket", "push", ...(custom && !emailAlreadySent ? ["email"] : [])],
    ...(custom && !emailAlreadySent ? { emailTemplate: emailKey, emailData: mergedData } : {}),
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

module.exports = { emit, emitInBackground, resolveAudienceUsers };
