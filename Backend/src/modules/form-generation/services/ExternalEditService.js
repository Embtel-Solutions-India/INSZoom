// Saves a form that a case manager edited OUTSIDE the system (the autofilled official PDF opened in their own browser / PDF viewer) back onto its
// CaseForm. Two things are kept:
//   1. the edited PDF itself, as the case form's newest generated copy (a Document in the existing storage, plus a generatedPdfVersions entry);
//   2. every field value that differs from what the system had, written into the form's filledData and recorded as a MANUAL OVERRIDE, so a later
//      autofill never overwrites what was changed (AutoFillService leaves manual-override fields alone).
// Nothing is guessed: a field is read from the uploaded PDF by its exact AcroForm name, through the template's own field list.

const { PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } = require("pdf-lib");
const CaseForm = require("../../../models/CaseForm");
const MappingResolver = require("../../form-mapping/services/MappingResolver");
const SyncStateService = require("../../form-mapping/services/SyncStateService");
const PDFGenerationService = require("./PDFGenerationService");

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

const isBlank = (value) => value === undefined || value === null || value === "" || value === false;
// formatting-only differences (a phone number's punctuation, letter case, a "true" checkbox) are not edits
const squash = (value) => (value === true ? "on" : String(value ?? "")).replace(/[^a-z0-9]/gi, "").toLowerCase();
const same = (left, right) => (isBlank(left) && isBlank(right)) || squash(left) === squash(right);

function readWidgetValue(field) {
  if (field instanceof PDFTextField) return field.getText() || "";
  if (field instanceof PDFCheckBox) return field.isChecked();
  if (field instanceof PDFDropdown) return field.getSelected()[0] || "";
  if (field instanceof PDFRadioGroup) return field.getSelected() || "";
  return undefined; // buttons / signatures: never read
}

async function saveExternalEdit({ caseFormId, buffer, originalName, user, req }) {
  if (!buffer?.length || buffer.slice(0, 5).toString("latin1") !== "%PDF-") throw fail("Upload the edited PDF file (a PDF could not be read from this upload).");
  const caseForm = await CaseForm.findById(caseFormId).populate({ path: "formTemplateId", select: "-definition" });
  if (!caseForm) throw fail("Case form not found", 404);
  if (caseForm.isLocked || ["locked", "filed"].includes(caseForm.status)) throw fail("This form is locked; its saved copy cannot be replaced.", 409);
  const template = caseForm.formTemplateId;

  let pdf;
  try {
    pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  } catch {
    throw fail("The uploaded file is not a readable PDF.");
  }
  const form = pdf.getForm();
  const byName = new Map(form.getFields().map((field) => [field.getName(), field]));
  if (!byName.size) throw fail("The uploaded PDF has no fillable fields - upload the edited copy of the form you downloaded.");
  // a different form (or a flattened print) shares almost no field names with this template
  const templateFields = (template?.formFields || []).filter((field) => field.fieldName);
  const known = templateFields.filter((field) => byName.has(field.fieldName)).length;
  if (templateFields.length && known < Math.max(3, Math.floor(templateFields.length * 0.2))) {
    throw fail(`This PDF does not look like ${caseForm.formCode} (its field names do not match). Upload the file you downloaded for this form.`);
  }

  const filledData = caseForm.filledData && typeof caseForm.filledData === "object" ? JSON.parse(JSON.stringify(caseForm.filledData)) : {};
  const manualOverrides = { ...(caseForm.manualOverrides || {}) };
  const userId = user?._id;
  const changed = [];
  for (const field of templateFields) {
    const widget = byName.get(field.fieldName);
    if (!widget) continue;
    const next = readWidgetValue(widget);
    if (next === undefined) continue;
    const previous = MappingResolver.resolvePath(filledData, field.fieldId);
    if (same(previous, next)) continue;
    MappingResolver.setPath(filledData, field.fieldId, next);
    manualOverrides[field.fieldId] = { previousValue: previous, value: next, reason: "Edited in an external PDF viewer and saved back", overriddenBy: userId, overriddenAt: new Date() };
    SyncStateService.setManualOverride(caseForm, field.fieldId);
    changed.push({ fieldId: field.fieldId, fieldName: field.fieldName });
  }

  const document = await PDFGenerationService.createGeneratedDocument(caseForm, buffer, user, { valid: true, externalEdit: true }, { externalEdit: true, changedFields: changed.length }, "EXTERNAL EDIT");
  document.description = `${caseForm.formCode} PDF edited outside the system and saved back`;
  document.tags = [...new Set([...(document.tags || []), "external-edit"])];
  if (originalName) document.metadata = { ...(document.metadata || {}), uploadedFileName: originalName };
  await document.save();

  caseForm.set("filledData", filledData);
  caseForm.set("manualOverrides", manualOverrides);
  caseForm.markModified("filledData");
  caseForm.markModified("manualOverrides");
  caseForm.filledPdfPath = document.storageKey;
  caseForm.filledPdfUrl = document.documentUrl;
  caseForm.generatedPdfDocument = document._id;
  caseForm.generatedPdfVersions.push({
    versionNumber: (caseForm.generatedPdfVersions?.length || 0) + 1,
    generatedAt: new Date(),
    generatedBy: userId,
    pdfPath: document.storageKey,
    pdfUrl: document.documentUrl,
    document: document._id,
    watermark: "EXTERNAL EDIT",
    status: "externally_edited",
  });
  caseForm.lastModifiedAt = new Date();
  caseForm.auditHistory.push({
    action: "EXTERNAL_EDIT_SAVED",
    changes: { documentId: document._id, changedFieldCount: changed.length, changedFields: changed.slice(0, 200).map((item) => item.fieldName) },
    performedBy: userId,
    ipAddress: req?.ip,
    userAgent: req?.headers?.["user-agent"],
  });
  await caseForm.save();
  return { caseFormId: caseForm._id, documentId: document._id, changedFieldCount: changed.length, changedFields: changed.slice(0, 50).map((item) => item.fieldName) };
}

module.exports = { saveExternalEdit };
