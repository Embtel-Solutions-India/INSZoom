const AuditLog = require("../../../models/AuditLog");

class ImmigrationTimelineService {
  static userId(user) {
    return user?._id || user?.id || user;
  }

  static ensure(caseData) {
    caseData.immigrationLifecycle = caseData.immigrationLifecycle || {};
    caseData.immigrationLifecycle.journeyEvents = caseData.immigrationLifecycle.journeyEvents || [];
    return caseData.immigrationLifecycle;
  }

  static add(caseData, type, title, payload = {}, user) {
    const lifecycle = this.ensure(caseData);
    const event = {
      type,
      title,
      payload,
      occurredAt: payload.date || payload.occurredAt || new Date(),
      createdBy: this.userId(user),
      createdAt: new Date(),
    };
    lifecycle.journeyEvents.push(event);
    caseData.timeline.push({
      type: `immigration_${type}`,
      title,
      description: payload.description || title,
      metadata: payload,
      createdBy: this.userId(user),
      createdAt: new Date(),
    });
    lifecycle.lastLifecycleUpdatedAt = new Date();
    lifecycle.lastLifecycleUpdatedBy = this.userId(user);
    return event;
  }

  static audit(caseData, action, user, changes = {}, req) {
    caseData.auditHistory.push({
      action,
      entity: "immigration_lifecycle",
      changes,
      performedBy: this.userId(user),
      performedAt: new Date(),
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: action.replace(/_/g, " "),
    });
  }

  static async writeAudit(action, caseData, user, changes = {}, req) {
    await AuditLog.create({
      userId: this.userId(user),
      userRole: user?.role,
      action,
      entityType: "Case",
      entityId: String(caseData._id),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} on immigration lifecycle for ${caseData.caseNumber}`,
    }).catch(() => null);
  }

  static list(caseData) {
    const lifecycleEvents = caseData.immigrationLifecycle?.journeyEvents || [];
    const caseEvents = (caseData.timeline || []).filter((event) => String(event.type || "").startsWith("immigration_"));
    return [...lifecycleEvents, ...caseEvents].sort((a, b) => new Date(b.occurredAt || b.createdAt) - new Date(a.occurredAt || a.createdAt));
  }
}

module.exports = ImmigrationTimelineService;
