const Case = require("../../models/Case");
const CaseForm = require("../../models/CaseForm");
const Document = require("../../models/Document");
const caseService = require("./case.service");
const caseWorkbookService = require("../document-intelligence/services/case-workbook.service");
const googleDriveService = require("../integrations/google-drive.service");

function userId(user) {
  return user?._id || user?.id || user;
}

async function loadCase(caseId) {
  return Case.findById(caseId);
}

async function recordAutomationIssue(caseData, key, error, user, req) {
  if (!caseData) return;
  const issue = {
    type: key,
    message: error?.message || String(error),
    createdAt: new Date(),
  };
  caseData.knowledgePlan = {
    ...(caseData.knowledgePlan?.toObject?.() || caseData.knowledgePlan || {}),
    configurationIssues: [
      ...((caseData.knowledgePlan?.configurationIssues || []).filter((item) => item.type !== key)),
      issue,
    ],
    generatedAt: new Date(),
    generatedBy: userId(user),
  };
  caseService.addTimelineEvent(caseData, "automation", "Automation Pending", issue.message, user, { key, error: issue.message });
  caseService.addAuditEntry(caseData, "case_automation_pending", "Case automation step is pending", user, { key, error: issue.message }, req);
  await caseData.save();
}

async function syncDocumentsToDrive(caseId, user, req) {
  const caseData = await loadCase(caseId);
  if (!caseData) return { synced: 0, failed: 0, skipped: true };
  const documents = await Document.find({ caseId, deletedAt: { $exists: false }, storageKey: { $exists: true, $ne: "" } });
  let synced = 0;
  let failed = 0;
  try {
    await googleDriveService.ensureCaseFolders(caseId);
  } catch (error) {
    await recordAutomationIssue(caseData, "google_drive_case_folder", error, user, req);
  }
  for (const document of documents) {
    if (document.googleDrive?.syncStatus === "synced" && document.googleDrive?.fileId) {
      synced += 1;
      continue;
    }
    try {
      const result = await googleDriveService.syncDocument(document);
      if (result?.configured === false) failed += 1;
      else synced += 1;
    } catch (error) {
      failed += 1;
      await recordAutomationIssue(caseData, "google_drive_document_sync", error, user, req);
    }
  }
  caseService.addTimelineEvent(caseData, "google_drive", "Google Drive Synchronization Updated", `${synced} document(s) synchronized to the case folder.`, user, { synced, failed });
  await caseData.save();
  return { synced, failed };
}

async function generateWorkbook(caseId, user, req, reason) {
  const caseData = await loadCase(caseId);
  if (!caseData) return null;
  try {
    const result = await caseWorkbookService.generateForCase(caseId, user, req, reason);
    caseService.addTimelineEvent(result.caseData || caseData, "excel_workbook", "Case Excel Workbook Updated", "Client profile, documents, and extraction status were written into the case workbook.", user, { documentId: result.document?._id });
    await (result.caseData || caseData).save();
    return result;
  } catch (error) {
    await recordAutomationIssue(caseData, "excel_workbook_generation", error, user, req);
    return null;
  }
}

async function tryGenerateForms(caseId, user, req, reason) {
  const caseData = await loadCase(caseId);
  if (!caseData) return null;
  try {
    const lifecycleOrchestrator = require("./case-lifecycle-orchestrator.service");
    const result = await lifecycleOrchestrator.generateForms(caseId, user, req);
    const refreshed = await loadCase(caseId);
    caseService.addTimelineEvent(refreshed || caseData, "uscis_form", "USCIS Forms Auto-Filled", "Official USCIS forms were auto-filled from the canonical case profile.", user, { reason, generated: result.generated?.length || 0 });
    await (refreshed || caseData).save();
    return result;
  } catch (error) {
    await recordAutomationIssue(caseData, "uscis_form_generation", error, user, req);
    return null;
  }
}

async function runPostClientSubmission(caseId, user, req) {
  const [drive, workbook, forms] = await Promise.all([
    syncDocumentsToDrive(caseId, user, req),
    generateWorkbook(caseId, user, req, "client_intake_submitted"),
    tryGenerateForms(caseId, user, req, "client_intake_submitted"),
  ]);
  return { drive, workbook, forms };
}

async function runAfterExtractionApproval(caseId, user, req) {
  const workbook = await generateWorkbook(caseId, user, req, "ocr_extraction_approved");
  const forms = await tryGenerateForms(caseId, user, req, "ocr_extraction_approved");
  return { workbook, forms };
}

async function allFormsLocked(caseId) {
  const forms = await CaseForm.find({ caseId });
  return forms.length > 0 && forms.every((form) => ["locked", "finalized", "filed"].includes(form.status) || form.isLocked);
}

module.exports = {
  allFormsLocked,
  generateWorkbook,
  runAfterExtractionApproval,
  runPostClientSubmission,
  syncDocumentsToDrive,
  tryGenerateForms,
};
