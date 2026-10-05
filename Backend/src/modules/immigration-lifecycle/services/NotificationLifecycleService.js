const notificationService = require("../../notifications/notification.service");

class NotificationLifecycleService {
  static async roles(roles, payload, user, req) {
    return notificationService.createForRoles(roles, { source: "shared", channels: ["in_app", "socket"], category: "case", ...payload }, user, req).catch(() => []);
  }

  static async user(userId, payload, actor, req) {
    if (!userId) return null;
    return notificationService.createNotification({ source: "shared", userId, channels: ["in_app", "socket"], category: "case", ...payload }, actor, req).catch(() => null);
  }

  static async caseStakeholders(caseData, payload, user, req) {
    await Promise.all([
      this.user(caseData.user || caseData.clientProfile, payload, user, req),
      this.user(caseData.assignedCaseManager, payload, user, req),
      this.user(caseData.assignedAttorney, payload, user, req),
    ]);
    this.emitTriggerEvent(caseData, payload, user, req);
  }

  // The three people above are the existing recipients. The same moment also
  // alerts the audiences that were never told (team lead, admin, attorneys
  // with case access) - see modules/email/eventTriggers.catalog.js. The client
  // and case manager are marked covered so they get no second notification.
  static emitTriggerEvent(caseData, payload, user, req) {
    const status = payload.metadata?.status;
    const event = {
      rfe_received: "rfe.received",
      case_approved: "uscis.decision",
      case_rejected: "uscis.decision",
      petition_filed: "case.filed",
      case_closed: "case.closed",
    }[payload.type] || (payload.type === "case_stage_changed" && {
      rfe_issued: "rfe.received", approved: "uscis.decision", denied: "uscis.decision", filed: "case.filed", closed: "case.closed",
    }[status]);
    if (!event) return;
    const decision = payload.type === "case_rejected" || status === "denied" ? "Denied" : payload.type === "case_approved" || status === "approved" ? "Approved" : undefined;
    require("../../notifications/triggerEvents.service").emitInBackground(event, {
      caseId: caseData._id, actor: user, req,
      data: { ...(decision ? { decision } : {}), ...(caseData.rfeDeadline && event === "rfe.received" ? { rfeDeadline: new Date(caseData.rfeDeadline).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) } : {}) },
      covered: { client: { notified: true, emailed: true }, case_manager: { notified: true, emailed: false } },
      skipUserIds: [caseData.assignedAttorney, caseData.assignedCaseManager, caseData.user].filter(Boolean),
    });
  }
}

module.exports = NotificationLifecycleService;
