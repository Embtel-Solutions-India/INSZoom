const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const Document = require("../../../models/Document");
const caseService = require("../../cases/case.service");
const storageService = require("../../uploads/storage.service");
const googleDriveService = require("../../integrations/google-drive.service");

function idOf(value) {
  return value?._id?.toString?.() || value?.toString?.();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraph(value) {
  return `<p>${escapeHtml(value)}</p>`;
}

function table(headers, rows) {
  return `<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">
    <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
}

async function buildHtml(caseData, forms, documents) {
  const generatedForms = forms.filter((form) => form.generatedPdfDocument);
  const approvedDocuments = documents.filter((document) => ["approved", "under_review", "pending"].includes(document.reviewStatus || document.status));
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(caseData.caseNumber || caseData.caseId)} Petition Package</title>
    <style>
      body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111827; }
      h1, h2 { color: #0f172a; page-break-after: avoid; }
      h1 { font-size: 20pt; }
      h2 { font-size: 15pt; margin-top: 28px; }
      table { margin: 10px 0 18px; }
      th { background: #f1f5f9; text-align: left; }
      .page-break { page-break-before: always; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(caseData.caseNumber || caseData.caseId)} Petition Package</h1>
    ${paragraph(`Client: ${caseData.clientName || ""}`)}
    ${paragraph(`Visa Type: ${caseData.visaType || caseData.petitionType || ""}`)}
    ${paragraph(`Package: ${caseData.package || caseData.plan?.tier || ""}`)}

    <h2>Cover Letter</h2>
    ${paragraph(`This petition package is prepared for ${caseData.clientName || "the client"} under case ${caseData.caseNumber || caseData.caseId}.`)}
    ${paragraph("The package includes reviewed forms, supporting client documents, and evidence indexed below.")}

    <h2>Personal Letter</h2>
    ${paragraph(`${caseData.clientName || "The client"} respectfully submits this immigration case package with the supporting information and documents collected through the client portal.`)}

    <h2>USCIS Forms</h2>
    ${table(["Form", "Status", "Generated PDF", "Approval Date"], generatedForms.map((form) => [
      form.formCode,
      form.status,
      idOf(form.generatedPdfDocument),
      form.approvalDate || form.lockedAt || "",
    ]))}

    <h2>Document Index</h2>
    ${table(["Document", "Category", "Type", "Version", "Review Status", "Google Drive File"], approvedDocuments.map((document) => [
      document.originalName || document.originalFileName,
      document.category,
      document.documentType,
      document.currentVersion,
      document.reviewStatus || document.status,
      document.googleDrive?.fileId || "",
    ]))}

    <h2 class="page-break">Assembly Notes</h2>
    ${paragraph("Case Manager may edit this Word package before final printing and courier submission.")}
    ${paragraph("Physical printing, FedEx shipment, and USCIS filing are tracked separately in the case lifecycle.")}
  </body>
</html>`;
}

async function upsertPackageDocument(caseData, buffer, user, req, options = {}) {
  // documentType is parameterized so the new render() (petition-assembly
  // presentation draft) and the legacy generate() (case-workflow Word
  // package) upsert onto DISTINCT Documents — same documentType here would
  // make the two features silently overwrite each other's output in place.
  const documentType = options.documentType || "petition_word_package";
  const suffix = options.filenameSuffix || "petition-package";
  const extension = options.extension || "doc";
  const mimeType = options.mimeType || "application/msword";
  const originalName = `${caseData.caseNumber || caseData.caseId || caseData._id}-${suffix}.${extension}`;
  const key = `cases/${caseData._id}/generated/${originalName}`;
  const stored = await storageService.storeBuffer(key, buffer);
  let document = await Document.findOne({ caseId: caseData._id, documentType, deletedAt: { $exists: false } });
  const payload = {
    user: caseData.user,
    caseId: caseData._id,
    client: caseData.clientProfile,
    beneficiary: caseData.beneficiary,
    companyId: caseData.companyId,
    teamId: caseData.teamId,
    category: "legal",
    documentType,
    description: options.description || "Editable petition package Word document",
    folderPath: `/cases/${caseData._id}/generated-documents`,
    folderName: "Generated Documents",
    tags: options.tags || ["petition", "word", "generated"],
    originalName,
    originalFileName: originalName,
    storedName: originalName,
    fileName: originalName,
    mimeType,
    fileType: mimeType,
    size: buffer.length,
    fileSize: buffer.length,
    filePath: stored.path,
    documentUrl: stored.url,
    storageProvider: stored.provider,
    storageKey: stored.key,
    checksum: stored.checksum,
    uploadedBy: "system",
    uploadedByUser: user?._id,
    status: "approved",
    reviewStatus: "approved",
    intelligenceStatus: "approved",
    legacySource: "shared",
    metadata: { generatedBy: "PetitionWordPackageService", caseId: caseData._id },
  };
  if (document) {
    Object.assign(document, payload);
    document.currentVersion = Number(document.currentVersion || 1) + 1;
    document.versions.push({
      version: document.currentVersion,
      originalName,
      storedName: originalName,
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
      changeReason: options.changeReason || "Petition Word package regenerated",
    });
  } else {
    document = new Document({
      ...payload,
      currentVersion: 1,
      versions: [{
        version: 1,
        originalName,
        storedName: originalName,
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
      }],
    });
  }
  document.auditHistory.push({ action: options.auditAction || "petition_word_package_generated", changes: { caseId: caseData._id, storageKey: stored.key }, performedBy: user?._id, ipAddress: req?.ip, userAgent: req?.headers?.["user-agent"] });
  await document.save();
  return document;
}

async function generate(caseId, user, req, reason = "forms_completed") {
  const caseData = await Case.findById(caseId);
  if (!caseData) throw Object.assign(new Error("Case not found"), { status: 404 });
  if (!caseService.canAccessCase(user, caseData)) throw Object.assign(new Error("Not authorized to generate petition package"), { status: 403 });
  const [forms, documents] = await Promise.all([
    CaseForm.find({ caseId }).sort({ formCode: 1 }),
    Document.find({ caseId, deletedAt: { $exists: false } }).sort({ category: 1, originalName: 1 }),
  ]);
  if (!forms.length) throw Object.assign(new Error("No USCIS forms are available for this case"), { status: 409 });
  const html = await buildHtml(caseData, forms, documents);
  const document = await upsertPackageDocument(caseData, Buffer.from(html, "utf8"), user, req);
  try {
    await googleDriveService.syncDocument(document);
  } catch (error) {
    document.googleDrive = { ...(document.googleDrive || {}), syncStatus: "failed", lastError: error.message, lastAttemptAt: new Date() };
    await document.save();
  }
  caseData.attachmentReferences = [...new Set([...(caseData.attachmentReferences || []).map(String), String(document._id)])];
  caseService.addTimelineEvent(caseData, "petition_package", "Petition Word Package Generated", "Editable Word petition package was generated from approved forms and case documents.", user, { documentId: document._id, reason });
  caseService.addAuditEntry(caseData, "petition_word_package_generated", "Petition Word package generated", user, { documentId: document._id, reason }, req);
  await caseData.save();
  return { document, forms: forms.length, documents: documents.length };
}

const SECTION_HEADINGS = {
  cover_letter: "Cover Letter",
  support_letter: "Support Letter",
  personal_statement: "Personal Statement",
  certification: "Certifications",
  form: "USCIS Forms",
  exhibit: "Exhibits",
};

// Real content, in ordering.presentation order — never a hardcoded
// placeholder paragraph. Forms/exhibits are summarized with a reference to
// the assembled mailing PDF (the presentation copy is the working/editable
// draft; the mailing PDF is the print-ready petition), everything else
// (cover letter, front-matter letters) is embedded verbatim.
function buildPresentationHtml({ caseData, definition, coverLetterHtml, letters, exhibitIndexHtml, forms }) {
  const sectionsHtml = (definition.ordering?.presentation || []).map((sectionType) => {
    if (sectionType === "cover_letter") return `<h2>Cover Letter</h2>${coverLetterHtml || paragraph("Cover letter not yet generated.")}`;
    // Generic front-matter letter section — works for any letterSlot key
    // the active PackageDefinition defines (support_letter,
    // position_description, itinerary, personal_statement, or a future
    // slot added purely as data) rather than hardcoding each slot key here.
    if (letters[sectionType]) return `<h2>${escapeHtml(letters[sectionType].title || SECTION_HEADINGS[sectionType] || sectionType)}</h2>${letters[sectionType].html}`;
    if (sectionType === "certification") {
      const rows = (definition.requiredCertifications || []).map((cert) => [cert.label, cert.required ? "Required" : "Optional"]);
      return rows.length ? `<h2>${SECTION_HEADINGS.certification}</h2>${table(["Certification", ""], rows)}` : "";
    }
    if (sectionType === "form") {
      const rows = forms.map((form) => [form.formCode, form.status, idOf(form.generatedPdfDocument) || "(not yet generated)"]);
      return rows.length ? `<h2 class="page-break">${SECTION_HEADINGS.form}</h2>${paragraph("See the assembled mailing PDF for the print-ready, signed copies of each form below.")}${table(["Form", "Status", "Generated PDF"], rows)}` : "";
    }
    if (sectionType === "exhibit") {
      return `<h2 class="page-break">Exhibit Index</h2>${paragraph("Tabbed exhibits follow the forms in the mailing packet; see the assembled mailing PDF for the exhibits themselves.")}${exhibitIndexHtml || ""}`;
    }
    return "";
  }).filter(Boolean).join("\n");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(caseData.caseNumber || caseData.caseId)} Petition Package (Presentation Draft)</title>
    <style>
      body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.45; color: #111827; }
      h1, h2 { color: #0f172a; page-break-after: avoid; }
      h1 { font-size: 20pt; }
      h2 { font-size: 15pt; margin-top: 28px; }
      table { margin: 10px 0 18px; }
      th { background: #f1f5f9; text-align: left; }
      .page-break { page-break-before: always; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(caseData.caseNumber || caseData.caseId)} — ${escapeHtml(definition.displayName || caseData.visaType || "")}</h1>
    ${paragraph(`Client: ${caseData.clientName || ""}`)}
    ${paragraph(`Visa Type: ${caseData.visaType || caseData.petitionType || ""}`)}
    ${paragraph("This is the case manager's editable working draft (presentation order). The print-ready mailing packet is assembled separately in USCIS filing order.")}
    ${sectionsHtml}
  </body>
</html>`;
}

// render() is the petition-assembly presentation-draft path — distinct
// document/persistence from the legacy generate() above (see
// upsertPackageDocument's documentType parameterization) so the two never
// collide on the same Document. Does NOT save `caseData` itself — the
// orchestrator (PetitionAssemblyService) owns the case-level audit entry
// and save, once, after all its steps complete, to avoid two competing
// saves on the same in-memory Case document.
async function render({ caseData, definition, coverLetterHtml, letters = {}, exhibitIndexHtml, forms }, user, req) {
  const html = buildPresentationHtml({ caseData, definition, coverLetterHtml, letters, exhibitIndexHtml, forms });
  // Real OOXML .docx (html-to-docx) rather than the legacy HTML-as-.doc
  // trick generate() still uses — opens natively in Word/LibreOffice/Google
  // Docs with no "this file might be corrupt" prompt. Falls back to the
  // legacy technique only if the dependency is somehow unavailable at
  // runtime, so this path never hard-fails just because the DOCX renderer
  // is missing.
  let buffer;
  let extension = "docx";
  let mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  try {
    const HTMLtoDOCX = require("html-to-docx");
    buffer = Buffer.from(await HTMLtoDOCX(html, null, { title: `${caseData.caseNumber || caseData.caseId} Petition Package` }));
  } catch (error) {
    buffer = Buffer.from(html, "utf8");
    extension = "doc";
    mimeType = "application/msword";
  }
  const document = await upsertPackageDocument(caseData, buffer, user, req, {
    documentType: "petition_presentation_package",
    filenameSuffix: "presentation-draft",
    extension,
    mimeType,
    description: "Editable petition presentation draft (case manager working copy)",
    tags: ["petition", "presentation", "word", "generated"],
    changeReason: "Petition presentation draft regenerated",
    auditAction: "petition_presentation_package_generated",
  });
  return { document };
}

module.exports = {
  generate,
  render,
};
