const ImmigrationTimelineService = require("./ImmigrationTimelineService");
const NotificationLifecycleService = require("./NotificationLifecycleService");

class DeadlineService {
  static addDeadline(caseData, payload, user) {
    const lifecycle = ImmigrationTimelineService.ensure(caseData);
    const deadline = {
      type: payload.type,
      label: payload.label || payload.type,
      dueDate: payload.dueDate ? new Date(payload.dueDate) : undefined,
      source: payload.source || "manual",
      status: payload.status || "open",
      priority: payload.priority || "medium",
      relatedEntity: payload.relatedEntity,
      reminderOffsets: payload.reminderOffsets || [180, 90, 60, 30, 14, 7],
      createdAt: new Date(),
      createdBy: ImmigrationTimelineService.userId(user),
    };
    lifecycle.deadlines.push(deadline);
    caseData.keyDates.push({ label: deadline.label, date: deadline.dueDate, completed: false });
    ImmigrationTimelineService.add(caseData, "deadline", `Deadline Added: ${deadline.label}`, deadline, user);
    return deadline;
  }

  static generateFromCase(caseData, user) {
    const generated = [];
    const add = (type, label, dueDate, source, priority = "medium") => {
      if (!dueDate) return;
      const existing = caseData.immigrationLifecycle?.deadlines?.some((item) => item.type === type && item.dueDate && new Date(item.dueDate).getTime() === new Date(dueDate).getTime());
      if (!existing) generated.push(this.addDeadline(caseData, { type, label, dueDate, source, priority }, user));
    };
    add("visa_expiration", "Visa Expiration", caseData.visaExpirationDate, "case", "high");
    add("filing_deadline", "Filing Deadline", caseData.filingDeadline, "case", "high");
    add("rfe_deadline", "RFE Deadline", caseData.rfeDeadline, "rfe", "urgent");
    add("interview", "Interview Date", caseData.interviewDate, "uscis", "high");
    add("biometrics", "Biometrics Appointment", caseData.biometricAppointmentDate, "uscis", "medium");
    return generated;
  }

  static upcoming(caseData, days = 365) {
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return (caseData.immigrationLifecycle?.deadlines || [])
      .filter((deadline) => deadline.dueDate && new Date(deadline.dueDate) >= now && new Date(deadline.dueDate) <= end && deadline.status !== "completed")
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  }

  static futureRecommendations(caseData) {
    const recommendations = [];
    const addExpiration = (date, type, title, daysBefore) => {
      if (!date) return;
      const diffDays = Math.ceil((new Date(date) - new Date()) / (24 * 60 * 60 * 1000));
      if (diffDays > 0 && diffDays <= daysBefore) recommendations.push({ type, title, dueDate: date, daysRemaining: diffDays, priority: diffDays <= 60 ? "urgent" : "high" });
    };
    addExpiration(caseData.visaExpirationDate, "renewal_recommended", "Visa renewal or extension consultation recommended", 180);
    addExpiration(caseData.beneficiary?.passportExpirationDate, "passport_renewal", "Passport renewal request recommended", 180);
    addExpiration(caseData.rfeDeadline, "rfe_deadline", "RFE response deadline approaching", 30);
    return recommendations;
  }

  static async notifyApproaching(caseData, user, req) {
    const urgent = this.upcoming(caseData, 30);
    if (!urgent.length) return [];
    return NotificationLifecycleService.caseStakeholders(caseData, {
      type: "filing_deadline_approaching",
      title: "Immigration deadline approaching",
      message: `${urgent[0].label} is due on ${new Date(urgent[0].dueDate).toLocaleDateString()}.`,
      caseId: caseData._id,
      metadata: { deadlines: urgent },
    }, user, req);
  }
}

module.exports = DeadlineService;
