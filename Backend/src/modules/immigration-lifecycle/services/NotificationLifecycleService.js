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
  }
}

module.exports = NotificationLifecycleService;
