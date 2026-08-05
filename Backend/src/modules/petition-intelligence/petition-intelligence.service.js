const AuditLog = require("../../models/AuditLog");
const Case = require("../../models/Case");
const Document = require("../../models/Document");
const CanonicalProfileService = require("../canonical/services/CanonicalProfileService");
const caseService = require("../cases/case.service");
const evidenceService = require("../documents/evidence.service");
const aiOrchestration = require("../ai/ai-orchestration.service");
const storageService = require("../uploads/storage.service");
const workflowService = require("../workflows/workflow.service");

const ARTIFACT_TYPES = {
  petition_draft: { label: "Petition Draft", documentType: "petition_draft", event: "petition.draft.completed" },
  cover_letter: { label: "Cover Letter", documentType: "cover_letter" },
  support_letter: { label: "Support Letter", documentType: "support_letter" },
  attorney_summary: { label: "Attorney Summary", documentType: "attorney_summary" },
  case_summary: { label: "Case Summary", documentType: "case_summary" },
  rfe_draft: { label: "RFE Response Draft", documentType: "rfe_draft" },
  evidence_summary: { label: "Evidence Summary", documentType: "evidence_summary" },
};

function artifactType(type) {
  const config = ARTIFACT_TYPES[type];
  if (!config) throw Object.assign(new Error(`Unsupported petition artifact type: ${type}`), { status: 422 });
  return config;
}

async function loadCase(caseId, user) {
  const caseData = await Case.findById(caseId);
  if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (!caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Not authorized to access this case"), { status: 403 });
  return caseData;
}

async function storeArtifact(caseData, type, generated, aiJob, user) {
  const config = artifactType(type);
  const body = JSON.stringify(generated, null, 2);
  const buffer = Buffer.from(body, "utf8");
  const originalName = `${config.documentType}-${caseData.caseNumber}-${Date.now()}.json`.replace(/[^\w.-]+/g, "-");
  const key = storageService.generateDocumentKey({ caseId: caseData._id, userId: user?._id, originalName });
  const stored = await storageService.storeBuffer(key, buffer);
  const version = {
    version: 1,
    originalName,
    storedName: key.split("/").pop(),
    storageProvider: stored.provider,
    storageKey: stored.key,
    filePath: stored.path,
    documentUrl: stored.url,
    mimeType: "application/json",
    fileType: "application/json",
    size: buffer.length,
    checksum: stored.checksum,
    uploadedByUser: user?._id,
    uploadedByRole: user?.role,
  };
  return Document.create({
    user: caseData.user,
    caseId: caseData._id,
    client: caseData.clientProfile,
    beneficiary: caseData.beneficiary,
    companyId: caseData.companyId,
    category: "legal",
    documentType: config.documentType,
    description: `${config.label} generated for professional review`,
    folderPath: `/cases/${caseData._id}/petition-intelligence`,
    folderName: "Petition Intelligence",
    tags: ["ai-generated", "review-required", config.documentType, caseData.visaType].filter(Boolean),
    originalName,
    originalFileName: originalName,
    storedName: version.storedName,
    fileName: version.storedName,
    mimeType: "application/json",
    fileType: "application/json",
    size: buffer.length,
    fileSize: buffer.length,
    filePath: stored.path,
    documentUrl: stored.url,
    storageProvider: stored.provider,
    storageKey: stored.key,
    checksum: stored.checksum,
    uploadedBy: "system",
    uploadedByUser: user?._id,
    reviewStatus: "pending",
    metadata: {
      artifactType: type,
      generatedBy: aiJob.provider,
      aiJobId: aiJob._id,
      model: aiJob.model,
      promptVersion: aiJob.promptVersion,
      editable: true,
      requiresAttorneyReview: true,
    },
    versions: [version],
    legacySource: "shared",
  });
}

async function generate(caseId, payload, user, req) {
  const type = payload.type || "petition_draft";
  const config = artifactType(type);
  const caseData = await loadCase(caseId, user);
  const [canonicalState, evidence] = await Promise.all([
    CanonicalProfileService.get(caseData._id, user, req, { rebuild: false, reason: "petition_intelligence" }),
    evidenceService.caseEvidenceSummary(caseData._id, user),
  ]);
  const aiJob = await aiOrchestration.run("draft", {
    caseId: caseData._id,
    artifactType: type,
    focus: payload.focus,
    templateInstructions: payload.templateInstructions,
    retain: true,
  }, user, req);
  const generated = aiJob.output;
  const document = await storeArtifact(caseData, type, generated, aiJob, user);
  caseData.documentReferences.addToSet(document._id);
  caseService.addTimelineEvent(caseData, "petition_intelligence", `${config.label} Generated`, "AI-assisted draft generated and queued for professional review", user, { documentId: document._id, type });
  caseService.addAuditEntry(caseData, "petition_artifact_generated", `${config.label} generated`, user, { documentId: document._id, type }, req);
  await caseData.save();
  await AuditLog.create({
    userId: user?._id,
    action: "petition_artifact_generated",
    entityType: "case",
    entityId: String(caseData._id),
    changes: { documentId: document._id, type },
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
    description: `${config.label} generated for case ${caseData.caseNumber}`,
  });
  if (config.event) {
    await workflowService.triggerWorkflow(config.event, {
      caseId: caseData._id,
      entityId: caseData._id,
      entityType: "case",
      documentId: document._id,
      artifactType: type,
    }, user, req).catch(() => null);
  }
  return {
    document,
    generated,
    aiJobId: aiJob._id,
    provider: aiJob.provider,
    model: aiJob.model,
    canonicalVersion: canonicalState.version,
    evidenceCoverage: evidence.coveragePercentage,
  };
}

async function list(caseId, user) {
  const caseData = await loadCase(caseId, user);
  return Document.find({
    caseId: caseData._id,
    "metadata.artifactType": { $in: Object.keys(ARTIFACT_TYPES) },
    deletedAt: { $exists: false },
  }).select("-ocr.rawText -aiExtractedData").sort({ createdAt: -1 });
}

module.exports = { ARTIFACT_TYPES, generate, list };
