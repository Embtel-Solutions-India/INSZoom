const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const Document = require("../../models/Document");
const Task = require("../../models/Task");
const CanonicalProfileService = require("../canonical/services/CanonicalProfileService");
const caseService = require("../cases/case.service");
const evidenceService = require("../documents/evidence.service");
const { normalizeRole } = require("../authorization/roleHierarchy");

function compactTimeline(caseData, role) {
  const clientFacing = ["client", "user", "employer"].includes(role);
  return (caseData.timeline || [])
    .filter((event) => !clientFacing || !event.metadata?.internalOnly)
    .slice(-50)
    .map((event) => ({ type: event.type, title: event.title, description: event.description, createdAt: event.createdAt }));
}

async function build(caseId, user, req) {
  const caseData = await caseService.getAccessibleCaseOrThrow(caseId, user);
  const role = normalizeRole(user.role);
  const [canonical, evidence, forms, documents, tasks] = await Promise.all([
    CanonicalProfileService.get(caseData._id, user, req, { rebuild: false, reason: "ai_context" }),
    evidenceService.caseEvidenceSummary(caseData._id, user),
    CaseForm.find({ caseId: caseData._id }).select("formCode formVersion formEditionDate status completion validationResults syncState").lean(),
    Document.find({ caseId: caseData._id, deletedAt: { $exists: false } })
      .select("originalName documentType category reviewStatus expiryDate extractionConfidence ocr.status ocr.confidence evidenceAssociations")
      .limit(500)
      .lean(),
    Task.find({ caseId: caseData._id, status: { $nin: ["cancelled"] } }).select("title description status priority category dueDate assignedRole").limit(500).lean(),
  ]);
  const serializedCase = caseService.serializeCaseForUser(caseData, user);
  const context = {
    case: {
      _id: serializedCase._id,
      caseNumber: serializedCase.caseNumber,
      visaType: serializedCase.visaType,
      visaCategory: serializedCase.visaCategory,
      petitionType: serializedCase.petitionType,
      stage: serializedCase.stage,
      status: serializedCase.status,
      priority: serializedCase.priority,
      filingDeadline: serializedCase.filingDeadline,
      rfeDeadline: serializedCase.rfeDeadline,
      interviewDate: serializedCase.interviewDate,
      biometricAppointmentDate: serializedCase.biometricAppointmentDate,
      attorneyReview: serializedCase.attorneyReview,
    },
    canonicalProfile: canonical.profile,
    canonicalValidation: canonical.validation,
    conflicts: canonical.conflicts,
    evidence: {
      coveragePercentage: evidence.coveragePercentage,
      requirements: evidence.requirements,
      missing: evidence.missing,
    },
    forms,
    documents,
    tasks,
    timeline: compactTimeline(caseData, role),
  };
  if (!["attorney", "super_admin", "admin", "team_lead", "case_manager", "paralegal", "reviewer"].includes(role)) {
    delete context.case.attorneyReview;
    context.tasks = context.tasks.filter((task) => task.assignedRole === role || task.category === "client_communication");
  }
  return { caseData, canonical, evidence, forms, documents, tasks, context };
}

module.exports = { build };
