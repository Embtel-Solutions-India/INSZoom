const Answer = require("../../models/Answer");
const Beneficiary = require("../../models/Beneficiary");
const Case = require("../../models/Case");
const Document = require("../../models/Document");
const Payment = require("../../models/Payment");
const Task = require("../../models/Task");
const notificationService = require("./notification.service");
const workflowService = require("../workflows/workflow.service");

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_CASE_STATUSES = ["active", "pending", "in_review", "pending_approval", "ready_for_filing", "rfe"];

function idOf(value) {
  return value?._id || value;
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value) {
  const date = new Date(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function dateWindow(days, now = new Date()) {
  const target = new Date(now.getTime() + days * DAY_MS);
  return { $gte: startOfDay(target), $lte: endOfDay(target) };
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value, now = new Date()) {
  const date = parseDate(value);
  return date ? Math.ceil((startOfDay(date) - startOfDay(now)) / DAY_MS) : null;
}

function caseClientUser(caseData) {
  return idOf(caseData.user) || idOf(caseData.clientProfile?.user) || idOf(caseData.clientProfile?.userId);
}

async function notify(payload) {
  if (!payload.userId) return null;
  return notificationService.createNotification({
    source: "system",
    category: payload.category || "workflow",
    channels: payload.channels || ["in_app", "email"],
    clientVisible: payload.clientVisible !== false,
    ...payload,
  }, null, null);
}

async function ensureTask({ marker, caseData, assignedTo, title, description, dueDate, priority, category }) {
  if (!assignedTo || !caseData?._id) return null;
  const existing = await Task.findOne({
    caseId: caseData._id,
    tags: marker,
    status: { $nin: ["completed", "cancelled"] },
  });
  if (existing) return existing;
  return Task.create({
    title,
    description,
    caseId: caseData._id,
    clientId: caseClientUser(caseData),
    assignedTo,
    assignedBy: caseData.assignedTeamLead || caseData.primaryOwner || assignedTo,
    dueDate,
    priority,
    category,
    tags: [marker, "automated_reminder"],
    source: "automation",
    status: "assigned",
    auditHistory: [{ action: "automated_reminder_task_created", changes: { marker }, performedAt: new Date() }],
  });
}

async function notifyCaseDate(caseData, config, days) {
  const clientUser = caseClientUser(caseData);
  const priority = days <= 3 ? "urgent" : days <= 14 ? "high" : "medium";
  const eventKey = `${config.type}:${caseData._id}:${days}:${parseDate(caseData[config.path])?.toISOString().slice(0, 10)}`;
  const recipients = [
    { userId: clientUser, title: config.clientTitle(days), message: config.clientMessage(caseData, days), clientVisible: true },
    { userId: idOf(caseData.assignedCaseManager || caseData.primaryOwner), title: config.staffTitle(days), message: config.staffMessage(caseData, days), clientVisible: false },
    ...(config.attorney ? [{ userId: idOf(caseData.assignedAttorney), title: config.staffTitle(days), message: config.staffMessage(caseData, days), clientVisible: false }] : []),
  ];
  await Promise.all(recipients.filter((item) => item.userId).map((item) => notify({
    ...item,
    type: config.type,
    priority,
    caseId: caseData._id,
    link: item.clientVisible ? "/dashboard" : `/cases/${caseData._id}`,
    internalOnly: !item.clientVisible,
    dedupeKey: `${eventKey}:${item.userId}`,
  })));
  if (config.task && days <= config.task.threshold) {
    const assignedTo = config.task.attorney ? caseData.assignedAttorney : caseData.assignedCaseManager || caseData.primaryOwner;
    await ensureTask({
      marker: `${config.type}_${caseData._id}_${parseDate(caseData[config.path])?.toISOString().slice(0, 10)}`,
      caseData,
      assignedTo,
      title: config.task.title(caseData),
      description: config.staffMessage(caseData, days),
      dueDate: new Date(parseDate(caseData[config.path]).getTime() - config.task.leadDays * DAY_MS),
      priority,
      category: config.task.category,
    });
  }
  await workflowService.triggerWorkflow(`${config.type}.approaching`, {
    caseId: caseData._id,
    entityId: caseData._id,
    daysRemaining: days,
    deadline: caseData[config.path],
  }, null).catch(() => null);
}

const CASE_DATE_CONFIGS = [
  {
    path: "visaExpirationDate",
    days: [180, 90, 60, 30, 7],
    type: "visa_expiring",
    clientTitle: (days) => `Visa Expiring in ${days} Days`,
    clientMessage: (item, days) => `Your visa for case ${item.caseNumber} expires in ${days} days.`,
    staffTitle: (days) => `Client Visa Expiring in ${days} Days`,
    staffMessage: (item, days) => `${item.clientName || "Client"}'s visa for case ${item.caseNumber} expires in ${days} days.`,
    task: { threshold: 60, leadDays: 30, category: "renewal", title: (item) => `Visa Renewal - ${item.caseNumber}` },
  },
  {
    path: "filingDeadline",
    days: [30, 14, 7],
    type: "filing_deadline_approaching",
    attorney: true,
    clientTitle: (days) => `Filing Deadline in ${days} Days`,
    clientMessage: (item, days) => `Your case ${item.caseNumber} has a filing deadline in ${days} days.`,
    staffTitle: (days) => `Filing Deadline in ${days} Days`,
    staffMessage: (item, days) => `Case ${item.caseNumber} must be filed within ${days} days.`,
    task: { threshold: 14, leadDays: 2, attorney: true, category: "deadline", title: (item) => `Filing Deadline - ${item.caseNumber}` },
  },
  {
    path: "rfeDeadline",
    days: [30, 14, 7],
    type: "rfe_deadline_approaching",
    attorney: true,
    clientTitle: (days) => `RFE Response Due in ${days} Days`,
    clientMessage: (item, days) => `The response deadline for your case ${item.caseNumber} is in ${days} days.`,
    staffTitle: (days) => `RFE Response Due in ${days} Days`,
    staffMessage: (item, days) => `RFE response for case ${item.caseNumber} is due in ${days} days.`,
    task: { threshold: 14, leadDays: 2, attorney: true, category: "rfe_response", title: (item) => `RFE Response - ${item.caseNumber}` },
  },
  {
    path: "interviewDate",
    days: [14, 7, 3, 1],
    type: "interview_scheduled",
    attorney: true,
    clientTitle: (days) => `Interview in ${days} Days`,
    clientMessage: (item, days) => `Your interview for case ${item.caseNumber} is scheduled in ${days} days.`,
    staffTitle: (days) => `Client Interview in ${days} Days`,
    staffMessage: (item, days) => `${item.clientName || "Client"} has an interview in ${days} days for case ${item.caseNumber}.`,
    task: { threshold: 7, leadDays: 1, attorney: true, category: "follow_up", title: (item) => `Interview Preparation - ${item.caseNumber}` },
  },
  {
    path: "biometricAppointmentDate",
    days: [7, 3, 1],
    type: "biometric_appointment",
    clientTitle: (days) => `Biometric Appointment in ${days} Days`,
    clientMessage: (item, days) => `Your biometric appointment for case ${item.caseNumber} is in ${days} days.`,
    staffTitle: (days) => `Client Biometrics in ${days} Days`,
    staffMessage: (item, days) => `${item.clientName || "Client"} has a biometric appointment in ${days} days.`,
  },
];

async function processCaseDates(now = new Date()) {
  let generated = 0;
  for (const config of CASE_DATE_CONFIGS) {
    for (const days of config.days) {
      const cases = await Case.find({
        [config.path]: dateWindow(days, now),
        status: { $in: ACTIVE_CASE_STATUSES },
      }).populate([
        { path: "clientProfile", select: "user userId" },
        { path: "assignedCaseManager", select: "_id" },
        { path: "assignedAttorney", select: "_id" },
      ]).limit(1000);
      for (const caseData of cases) {
        await notifyCaseDate(caseData, config, days);
        generated += 1;
      }
    }
  }
  return generated;
}

async function processPassportDates(now = new Date()) {
  const beneficiaries = await Beneficiary.find({
    status: "active",
    passportExpirationDate: { $exists: true, $nin: [null, ""] },
  }).select("user fullName passportExpirationDate assignedCaseManager caseIds").limit(5000).lean();
  let generated = 0;
  for (const beneficiary of beneficiaries) {
    const days = daysUntil(beneficiary.passportExpirationDate, now);
    if (![180, 90, 60, 30].includes(days)) continue;
    const caseId = beneficiary.caseIds?.[0];
    const priority = days <= 30 ? "urgent" : "high";
    await Promise.all([
      notify({
        userId: beneficiary.user,
        type: "passport_expiring",
        title: `Passport Expiring in ${days} Days`,
        message: "Please renew your passport to avoid delays in your immigration case.",
        priority,
        caseId,
        link: "/dashboard/documents",
        dedupeKey: `passport-expiry:${beneficiary._id}:${days}:${beneficiary.passportExpirationDate}`,
      }),
      notify({
        userId: beneficiary.assignedCaseManager,
        type: "client_passport_expiring",
        title: `Client Passport Expiring in ${days} Days`,
        message: `${beneficiary.fullName || "Client"}'s passport expires in ${days} days.`,
        priority,
        caseId,
        clientVisible: false,
        internalOnly: true,
        link: caseId ? `/cases/${caseId}` : "/cases",
        dedupeKey: `passport-expiry-staff:${beneficiary._id}:${days}:${beneficiary.passportExpirationDate}`,
      }),
    ]);
    generated += 1;
  }
  return generated;
}

async function processQuestionnaireReminders(now = new Date()) {
  const cutoff = new Date(now.getTime() - 7 * DAY_MS);
  const answers = await Answer.find({
    status: { $in: ["draft", "auto_saved"] },
    updatedAt: { $lte: cutoff },
  }).select("responseId caseId user assignedTo updatedAt dueDate").sort({ updatedAt: 1 }).limit(2000).lean();
  const responses = new Map();
  answers.forEach((answer) => {
    if (!responses.has(answer.responseId)) responses.set(answer.responseId, answer);
  });
  for (const answer of responses.values()) {
    const daysPending = Math.max(7, Math.floor((now - new Date(answer.updatedAt)) / DAY_MS));
    await notify({
      userId: answer.user,
      type: answer.dueDate && new Date(answer.dueDate) < now ? "questionnaire_overdue" : "questionnaire_reminder",
      title: "Complete Your Questionnaire",
      message: "Your immigration questionnaire is still incomplete.",
      priority: daysPending >= 21 ? "urgent" : "high",
      caseId: answer.caseId,
      link: "/dashboard/intake",
      dedupeKey: `questionnaire-reminder:${answer.responseId}:${Math.floor(daysPending / 7)}`,
    });
  }
  return responses.size;
}

async function processDocumentReminders(now = new Date()) {
  const documents = await Document.find({
    requestStatus: { $in: ["requested", "missing", "overdue", "rejected"] },
    deletedAt: { $exists: false },
  }).select("user caseId documentType originalName requestDueDate requestedAt requestStatus").limit(2000);
  for (const document of documents) {
    const overdue = document.requestDueDate && document.requestDueDate < now;
    if (overdue && document.requestStatus !== "overdue") {
      document.requestStatus = "overdue";
      await document.save();
    }
    await notify({
      userId: document.user,
      type: overdue ? "document_overdue" : "document_reminder",
      title: overdue ? "Requested Document Overdue" : "Document Requested",
      message: `${document.originalName || document.documentType || "A requested document"} is ${overdue ? "overdue" : "still required"}.`,
      priority: overdue ? "urgent" : "high",
      caseId: document.caseId,
      documentId: document._id,
      link: "/dashboard/documents",
      dedupeKey: `document-reminder:${document._id}:${overdue ? "overdue" : startOfDay(now).toISOString().slice(0, 10)}`,
    });
  }
  return documents.length;
}

async function processPaymentReminders(now = new Date()) {
  const payments = await Payment.find({
    paymentStatus: { $in: ["not_started", "pending", "partial", "partially_paid", "overdue"] },
  }).select("user case caseId invoiceNumber paymentSchedule schedule remainingAmount currency paymentStatus").limit(2000);
  let generated = 0;
  for (const payment of payments) {
    const schedules = payment.paymentSchedule || payment.schedule || [];
    for (const installment of schedules.filter((item) => !["paid", "cancelled"].includes(item.status))) {
      const days = daysUntil(installment.dueDate, now);
      if (![30, 14, 7, 0].includes(days) && !(days < 0)) continue;
      const overdue = days < 0;
      if (overdue) installment.status = "overdue";
      await notify({
        userId: payment.user,
        type: overdue ? "payment_overdue" : "payment_due",
        title: overdue ? "Payment Overdue" : `Payment Due in ${days} Days`,
        message: `Invoice ${payment.invoiceNumber || ""} has ${overdue ? "an overdue installment" : `an installment due in ${days} days`}.`,
        priority: overdue || days <= 7 ? "urgent" : "high",
        caseId: payment.caseId || payment.case,
        paymentId: payment._id,
        link: "/dashboard/payments",
        dedupeKey: `payment-reminder:${payment._id}:${installment._id}:${overdue ? "overdue" : days}`,
      });
      generated += 1;
    }
    if (payment.isModified()) await payment.save();
  }
  return generated;
}

async function runAll(now = new Date()) {
  const [caseDates, passports, questionnaires, documents, payments] = await Promise.all([
    processCaseDates(now),
    processPassportDates(now),
    processQuestionnaireReminders(now),
    processDocumentReminders(now),
    processPaymentReminders(now),
  ]);
  return { caseDates, passports, questionnaires, documents, payments };
}

module.exports = {
  CASE_DATE_CONFIGS,
  dateWindow,
  daysUntil,
  processCaseDates,
  processDocumentReminders,
  processPassportDates,
  processPaymentReminders,
  processQuestionnaireReminders,
  runAll,
};
