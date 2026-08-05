const Case = require("../../models/Case");
const caseService = require("../cases/case.service");
const canonicalSyncService = require("../canonical/services/CanonicalSyncService");
const workflowEngine = require("../workflows/workflow.service");
const notificationService = require("../notifications/notification.service");

function normalizeRequirement(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function matchingChecklistItems(caseData, document) {
  const documentKeys = new Set([
    document.documentType,
    document.category,
    document.originalName,
  ].map(normalizeRequirement).filter(Boolean));
  return [...(caseData.documentChecklist || [])].filter((item) => {
    const itemKeys = [item.documentType, item.name, item.category].map(normalizeRequirement).filter(Boolean);
    return itemKeys.some((key) => documentKeys.has(key) || [...documentKeys].some((documentKey) => documentKey.includes(key) || key.includes(documentKey)));
  });
}

function syncChecklist(caseData, document, status) {
  caseData.documentChecklist = caseData.documentChecklist || caseData.checklistItems || [];
  const matches = matchingChecklistItems(caseData, document);
  matches.forEach((item) => {
    item.status = status;
    item.uploadedDate = item.uploadedDate || new Date();
    item.submittedAt = item.submittedAt || new Date();
    if (["approved", "rejected"].includes(status)) item.reviewedAt = new Date();
    if (status === "rejected") item.adminNotes = document.reviewNotes || item.adminNotes;
    item.uploadedFiles = item.uploadedFiles || [];
    const alreadyLinked = item.uploadedFiles.some((file) => String(file.document || "") === String(document._id));
    if (!alreadyLinked) {
      item.uploadedFiles.push({
        originalName: document.originalName,
        storedName: document.storedName,
        storageKey: document.storageKey,
        size: document.size,
        mimeType: document.mimeType,
        document: document._id,
      });
    }
  });
  caseData.checklistItems = caseData.documentChecklist;
  return matches;
}

async function addCaseDocumentTimeline(document, user, title, description, metadata = {}) {
  if (!document.caseId) return;
  const caseData = await Case.findById(document.caseId);
  if (!caseData) return;
  caseService.addTimelineEvent(caseData, "document", title, description, user, {
    documentId: document._id,
    documentType: document.documentType,
    ...metadata,
  });
  caseService.addActivity(caseData, title, description, user);
  await caseData.save();
}

async function documentUploaded(document, user) {
  if (document.caseId) {
    const caseData = await Case.findById(document.caseId);
    if (caseData && syncChecklist(caseData, document, "uploaded").length) await caseData.save();
  }
  await addCaseDocumentTimeline(document, user, "Document Uploaded", `Document "${document.originalName || document.documentType}" uploaded`);
  await canonicalSyncService.syncFromDocument(document, user, null).catch(() => null);
  await workflowEngine.triggerWorkflow("document.uploaded", { caseId: document.caseId, entityId: document.caseId, documentId: document._id, documentType: document.documentType }, user).catch(() => {});
  if (document.caseId) await require("../cases/case-lifecycle-orchestrator.service").recalculate(document.caseId, user, null, "document_uploaded").catch(() => null);
}

async function documentReviewed(document, user) {
  if (document.caseId) {
    const caseData = await Case.findById(document.caseId);
    if (caseData && syncChecklist(caseData, document, document.reviewStatus === "needs_revision" ? "rejected" : document.reviewStatus).length) await caseData.save();
  }
  await addCaseDocumentTimeline(document, user, "Document Reviewed", `Document "${document.originalName || document.documentType}" marked ${document.reviewStatus}`, {
    reviewStatus: document.reviewStatus,
  });
  await canonicalSyncService.syncFromDocument(document, user, null).catch(() => null);
  if (["approved", "accepted"].includes(document.reviewStatus)) {
    await workflowEngine.triggerWorkflow("document.approved", { caseId: document.caseId, entityId: document.caseId, documentId: document._id, documentType: document.documentType, allDocumentsApproved: false }, user).catch(() => {});
  }
  if (["rejected", "needs_revision"].includes(document.reviewStatus)) {
    await workflowEngine.triggerWorkflow("document.rejected", {
      caseId: document.caseId,
      entityId: document.caseId,
      documentId: document._id,
      documentType: document.documentType,
      reason: document.reviewNotes,
    }, user).catch(() => {});
    await notificationService.createFromEvent("document.rejected", {
      userId: document.user,
      caseId: document.caseId,
      documentId: document._id,
      title: "Document Re-upload Required",
      message: document.reviewNotes || `Please upload a replacement for ${document.originalName || document.documentType}.`,
      link: "/dashboard/documents",
      dedupeKey: `document-reupload:${document._id}:${document.currentVersion}`,
    }, user, null).catch(() => []);
  }
  if (document.caseId) await require("../cases/case-lifecycle-orchestrator.service").recalculate(document.caseId, user, null, "document_reviewed").catch(() => null);
}

async function documentRestored(document, user) {
  await addCaseDocumentTimeline(document, user, "Document Restored", `Document "${document.originalName || document.documentType}" restored`);
  await workflowEngine.triggerWorkflow("document.restored", { caseId: document.caseId, entityId: document.caseId, documentId: document._id }, user).catch(() => {});
}

async function documentDeleted(document, user) {
  await addCaseDocumentTimeline(document, user, "Document Deleted", `Document "${document.originalName || document.documentType}" deleted`);
  await workflowEngine.triggerWorkflow("document.deleted", { caseId: document.caseId, entityId: document.caseId, documentId: document._id }, user).catch(() => {});
}

module.exports = {
  documentDeleted,
  documentReviewed,
  documentRestored,
  documentUploaded,
};
