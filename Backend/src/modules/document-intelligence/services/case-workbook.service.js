const Case = require("../../../models/Case");
const Client = require("../../../models/Client");
const Document = require("../../../models/Document");
const DocumentExtraction = require("../../../models/DocumentExtraction");
const storageService = require("../../uploads/storage.service");
const documentService = require("../../documents/document.service");
const googleDriveService = require("../../integrations/google-drive.service");

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function xml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function display(value) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function row(cells = []) {
  return `<Row>${cells.map((cell) => `<Cell><Data ss:Type="String">${xml(display(cell))}</Data></Cell>`).join("")}</Row>`;
}

function sheet(name, rows) {
  return `<Worksheet ss:Name="${xml(name).slice(0, 31)}"><Table>${rows.map(row).join("")}</Table></Worksheet>`;
}

function pairs(object = {}, prefix = "") {
  const output = [];
  Object.entries(object || {}).forEach(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) output.push(...pairs(value, path));
    else output.push([path, value]);
  });
  return output;
}

async function caseContext(caseId) {
  const caseData = await Case.findById(caseId).populate("user", "name displayName email").populate("assignedCaseManager", "name displayName email");
  if (!caseData) {
    const error = new Error("Case not found for workbook generation");
    error.statusCode = 404;
    throw error;
  }
  const [client, documents, extractions] = await Promise.all([
    caseData.clientProfile ? Client.findById(caseData.clientProfile) : Client.findOne({ user: caseData.user }),
    Document.find({ caseId, deletedAt: { $exists: false } }).sort({ category: 1, uploadDate: -1 }),
    DocumentExtraction.find({ caseId }).populate("documentId", "originalName originalFileName documentType category").sort({ updatedAt: -1 }),
  ]);
  return { caseData, client, documents, extractions };
}

function buildWorkbook({ caseData, client, documents, extractions }) {
  const profile = caseData.canonicalProfile?.profile || {};
  const rows = [];
  rows.push(sheet("Client Information", [
    ["Case Number", caseData.caseNumber || caseData.caseId],
    ["Client Name", caseData.clientName || client?.fullName],
    ["Client Email", caseData.clientEmail || client?.email],
    ["Visa Type", caseData.visaType],
    ["Assigned Case Manager", caseData.assignedCaseManager?.displayName || caseData.assignedCaseManager?.name],
    ["Canonical Status", caseData.canonicalProfile?.status],
    ["Canonical Version", caseData.canonicalProfile?.version],
    ["Generated At", new Date().toISOString()],
    [],
    ["Field", "Value"],
    ...pairs(profile.person || profile.client || profile).slice(0, 500),
  ]));

  rows.push(sheet("Passport", [
    ["Field", "Value"],
    ...pairs(profile.passport || client?.passportDetails || {}),
  ]));

  rows.push(sheet("Employment", [
    ["Employer", "Title", "Start Date", "End Date", "Current", "Notes"],
    ...((profile.employmentHistory || client?.employmentHistory || []).map((item) => [
      item.employer || item.company,
      item.jobTitle || item.title,
      item.startDate,
      item.endDate,
      item.current,
      item.notes || item.summary,
    ])),
  ]));

  rows.push(sheet("Education", [
    ["Institution", "Degree", "Field", "Start Date", "End Date", "Country"],
    ...((profile.educationHistory || client?.education || []).map((item) => [
      item.institution || item.university || item.school,
      item.degree,
      item.fieldOfStudy || item.major,
      item.startDate,
      item.endDate || item.graduationDate,
      item.country,
    ])),
  ]));

  rows.push(sheet("Immigration", [
    ["Field", "Value"],
    ...pairs(profile.immigration || client?.immigrationHistory || {}),
  ]));

  rows.push(sheet("Uploaded Documents", [
    ["Filename", "Category", "Type", "Version", "Uploaded By", "Uploaded At", "Document Status", "Processing Status", "Drive Status", "Drive File ID"],
    ...documents.map((document) => [
      document.originalName || document.originalFileName,
      document.category,
      document.documentType,
      document.currentVersion,
      document.uploadedBy,
      document.uploadDate,
      document.intelligenceStatus || document.processing?.status || document.aiExtractionStatus,
      document.processing?.stage,
      document.googleDrive?.syncStatus,
      document.googleDrive?.fileId,
    ]),
  ]));

  rows.push(sheet("Extraction Status", [
    ["Document", "Detected Type", "Confidence", "Status", "Review Status", "Missing Fields", "Processing Time MS", "Updated At"],
    ...extractions.map((extraction) => [
      extraction.documentId?.originalName || extraction.documentId?.originalFileName,
      extraction.documentType,
      extraction.confidence,
      extraction.status,
      extraction.reviewStatus,
      (extraction.missingFields || []).join(", "),
      extraction.processingTimeMs,
      extraction.updatedAt,
    ]),
  ]));

  rows.push(sheet("Review Status", [
    ["Document", "Field", "Value", "Confidence", "Review Status", "Reviewed By", "Reviewed At"],
    ...extractions.flatMap((extraction) => (extraction.extractedData || []).map((field) => [
      extraction.documentId?.originalName || extraction.documentId?.originalFileName,
      field.label || field.key,
      field.editedValue !== undefined ? field.editedValue : field.value,
      field.confidence,
      field.reviewStatus,
      field.reviewedBy,
      field.reviewedAt,
    ])),
  ]));

  return Buffer.from(`<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles><Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Top"/></Style></Styles>
 ${rows.join("")}
</Workbook>`, "utf8");
}

async function upsertWorkbookDocument(caseData, buffer, user, req) {
  const fileName = `${caseData.caseNumber || caseData.caseId || caseData._id}-case-data.xls`;
  const key = `cases/${caseData._id}/generated/${fileName}`;
  const stored = await storageService.storeBuffer(key, buffer);
  let document = caseData.excelWorkbook?.document ? await Document.findById(caseData.excelWorkbook.document) : null;
  if (!document) {
    document = await Document.findOne({ caseId: caseData._id, documentType: "case_data_workbook", deletedAt: { $exists: false } });
  }
  const payload = {
    user: caseData.user,
    caseId: caseData._id,
    client: caseData.clientProfile,
    beneficiary: caseData.beneficiary,
    companyId: caseData.companyId,
    teamId: caseData.teamId,
    category: "case",
    documentType: "case_data_workbook",
    originalName: fileName,
    originalFileName: fileName,
    storedName: fileName,
    fileName,
    mimeType: "application/vnd.ms-excel",
    fileType: "application/vnd.ms-excel",
    size: buffer.length,
    fileSize: buffer.length,
    storageProvider: stored.provider,
    storageKey: stored.key,
    filePath: stored.path,
    documentUrl: stored.url,
    checksum: stored.checksum,
    uploadedBy: "system",
    uploadedByUser: user?._id,
    status: "approved",
    reviewStatus: "approved",
    aiExtractionStatus: "completed",
    intelligenceStatus: "approved",
    legacySource: "shared",
  };
  if (document) {
    Object.assign(document, payload);
    document.currentVersion = Number(document.currentVersion || 1) + 1;
    document.versions.push({
      version: document.currentVersion,
      originalName: fileName,
      storedName: fileName,
      storageProvider: stored.provider,
      storageKey: stored.key,
      filePath: stored.path,
      documentUrl: stored.url,
      mimeType: payload.mimeType,
      fileType: payload.fileType,
      size: buffer.length,
      checksum: stored.checksum,
      uploadedByUser: user?._id,
      uploadedByRole: user?.role || "system",
      changeReason: "Document intelligence workbook regenerated",
    });
  } else {
    document = new Document({ ...payload, currentVersion: 1, versions: [{
      version: 1,
      originalName: fileName,
      storedName: fileName,
      storageProvider: stored.provider,
      storageKey: stored.key,
      filePath: stored.path,
      documentUrl: stored.url,
      mimeType: payload.mimeType,
      fileType: payload.fileType,
      size: buffer.length,
      checksum: stored.checksum,
      uploadedByUser: user?._id,
      uploadedByRole: user?.role || "system",
    }] });
  }
  documentService.addAuditEntry(document, "case_workbook_generated", user, { caseId: caseData._id, storageKey: stored.key }, req);
  await document.save();
  return document;
}

async function generateForCase(caseId, user, req, reason = "document_intelligence_approved") {
  const context = await caseContext(caseId);
  context.caseData.excelWorkbook = { ...(context.caseData.excelWorkbook || {}), syncStatus: "generating", lastError: undefined };
  await context.caseData.save();
  const buffer = buildWorkbook(context);
  const workbookDocument = await upsertWorkbookDocument(context.caseData, buffer, user, req);
  let driveResult = null;
  try {
    driveResult = await googleDriveService.syncDocument(workbookDocument);
  } catch (error) {
    workbookDocument.googleDrive = { ...(workbookDocument.googleDrive || {}), syncStatus: "failed", lastError: error.message, lastAttemptAt: new Date() };
    await workbookDocument.save();
  }
  context.caseData.excelWorkbook = {
    ...(context.caseData.excelWorkbook || {}),
    syncStatus: "updated",
    document: workbookDocument._id,
    storageKey: workbookDocument.storageKey,
    googleDriveFileId: workbookDocument.googleDrive?.fileId,
    generatedAt: new Date(),
    generatedBy: user?._id,
    lastError: undefined,
  };
  context.caseData.canonicalHistory.push({
    version: context.caseData.canonicalProfile?.version,
    action: "case_workbook_generated",
    changes: { reason, documentId: workbookDocument._id, storageKey: workbookDocument.storageKey, driveFileId: driveResult?.file?.id },
    changedBy: user?._id,
    source: "document_intelligence",
    reason,
  });
  await context.caseData.save();
  return { document: workbookDocument, caseData: context.caseData };
}

module.exports = {
  generateForCase,
};
