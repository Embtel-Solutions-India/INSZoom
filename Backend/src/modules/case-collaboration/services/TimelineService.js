const AuditLog = require("../../../models/AuditLog");

class TimelineService {
  static userId(user) {
    return user?._id || user?.id || user;
  }

  static add(caseData, type, title, description, user, metadata = {}) {
    const event = {
      type,
      title,
      description,
      metadata,
      createdBy: this.userId(user),
      createdAt: new Date(),
    };
    caseData.timeline.push(event);
    return event;
  }

  static addAudit(caseData, action, user, changes = {}, req) {
    caseData.auditHistory.push({
      action,
      entity: "case",
      changes,
      performedBy: this.userId(user),
      performedAt: new Date(),
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: action.replace(/_/g, " "),
    });
  }

  static async writeAudit(action, entityType, entityId, user, changes = {}, req) {
    await AuditLog.create({
      userId: this.userId(user),
      userRole: user?.role,
      action,
      entityType,
      entityId: String(entityId),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} ${entityType}`,
    }).catch(() => null);
  }

  static list(caseData, user) {
    const role = user?.role;
    const timeline = caseData.timeline || [];
    if (["client", "employer", "user"].includes(role)) {
      return timeline.filter((event) => !event.metadata?.internalOnly);
    }
    return timeline;
  }
}

module.exports = TimelineService;
