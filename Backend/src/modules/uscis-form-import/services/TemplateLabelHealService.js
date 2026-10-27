// Self-healing of an already-stored template's box labels and types, triggered by the pipeline itself (OnDemandFormAcquisitionService.ensureCurrentUSCISForm) - no script, no person.
//
// A template imported before the label rules existed, or from a PDF whose tooltips / names were copied from another form (G-1650), can carry a wrong label ("Master Card" on a
// Savings box) or a wrong type (a Business Name typed as an SSN). The importer now gets these right at import (FieldLabelEnrichmentService + VisibleTextLabelService); this
// service brings every older template to the same result: it re-reads the template's own stored PDF, runs the same enrichment, and rewrites only the labels / types that differ.
//
// Safe by construction: it changes label / type text only (never a field id, widget, mapping or value), it is idempotent (a template that is already right is left alone and
// marked as checked for this HEAL_VERSION, so the PDF is never re-read again until the rules change), at most one run per template at a time, and it NEVER throws.
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const PDFFieldScannerService = require("./PDFFieldScannerService");
const FieldLabelEnrichmentService = require("./FieldLabelEnrichmentService");
const VisibleTextLabelService = require("./VisibleTextLabelService");
const storageService = require("../../uploads/storage.service");
const { normalizePdf } = require("../../../utils/normalizePdf");
const logger = require("../../../utils/logger");

// bump when the label / type rules change, so every template is checked once more
const HEAL_VERSION = 1;
// Only a defect this service exists to fix is rewritten: a label taken from the text printed beside the box, or from the box's own name because its tooltip was copied from another
// box, and a wrong type. A label that merely differs because a crosswalk note or the tooltip wording changed since the import is NOT a defect and is never rewritten.
// (Re-labelling an ALREADY-STORED template is deliberately limited to the type defect: a label that was already shown to case managers is only ever changed on a new import,
// or by the on-demand relabel script after a person has read its dry-run. The audit of every stored form showed label guesses are not safe to apply unattended.)
const DEFECT_SOURCES = new Set([]);
const MAX_AUTO_CHANGES = 12;
const inFlight = new Set();

const alreadyChecked = (template) => Number(template?.pdfMetadata?.labelHeal?.version || 0) >= HEAL_VERSION;

/** Re-reads the template's stored PDF and returns the corrected fields + the list of what differs. Reads only. */
async function computeChanges(template) {
  const key = template.artifacts?.form?.storageKey || template.pdfStorageKey;
  if (!key) throw Object.assign(new Error(`Template ${template._id} has no stored PDF artifact to re-scan`), { code: "NO_PDF_ARTIFACT" });
  const normalized = await normalizePdf(await storageService.readBuffer(key));
  const scanResult = await new PDFFieldScannerService().scan(normalized);

  const rescannedByName = new Map();
  scanResult.fields.forEach((field) => rescannedByName.set(field.fieldName, [...(rescannedByName.get(field.fieldName) || []), { tooltip: field.tooltip, type: field.type }]));
  const cursorByName = new Map();
  const withTooltip = (template.formFields || []).map((field) => {
    const plain = field.toObject ? field.toObject() : field;
    const cursor = cursorByName.get(plain.fieldName) || 0;
    cursorByName.set(plain.fieldName, cursor + 1);
    const rescanned = (rescannedByName.get(plain.fieldName) || [])[cursor] || {};
    return { ...plain, tooltip: rescanned.tooltip, rescannedType: rescanned.type };
  });

  // the text printed beside a box wins over a tooltip / name it contradicts
  const visibleLabels = await VisibleTextLabelService.collect(normalized, withTooltip);
  const enriched = FieldLabelEnrichmentService.enrichFields(withTooltip, template.formCode, { visibleLabels }).map(({ rescannedType, ...field }) => {
    // a box stored as an SSN only because its name contains the letters "ssn" (BusiNESSName) goes back to what a fresh scan says it is
    if (field.type === "ssn" && rescannedType && rescannedType !== "ssn") {
      const fix = (value) => (value === "ssn" ? rescannedType : value);
      return { ...field, type: rescannedType, fieldType: fix(field.fieldType), semanticType: fix(field.semanticType) };
    }
    return field;
  });
  const changes = enriched.map((field, index) => {
    const before = template.formFields[index] || {};
    return { index, field: field.fieldName, from: before.label, to: field.label, source: field.labelSource, typeFrom: before.type, typeTo: field.type };
  }).filter((item) => DEFECT_SOURCES.has(item.source) ? item.from !== item.to || item.typeFrom !== item.typeTo : item.typeFrom !== item.typeTo);
  return { enriched, changes, fieldCount: enriched.length };
}

/** Writes only the changed labels / types (and the checked marker). Never touches anything else on the template. */
async function applyChanges(template, { enriched, changes }) {
  const set = { "pdfMetadata.labelHeal": { version: HEAL_VERSION, at: new Date(), changed: changes.length } };
  for (const change of changes) {
    const field = enriched[change.index];
    const path = `formFields.${change.index}`;
    if (change.from !== change.to) {
      set[`${path}.label`] = field.label;
      set[`${path}.fieldLabel`] = field.fieldLabel ?? field.label;
      set[`${path}.labelSource`] = field.labelSource;
    }
    if (change.typeFrom !== change.typeTo) {
      set[`${path}.type`] = field.type;
      if (field.fieldType !== undefined) set[`${path}.fieldType`] = field.fieldType;
      if (field.semanticType !== undefined) set[`${path}.semanticType`] = field.semanticType;
    }
  }
  await USCISFormTemplate.updateOne({ _id: template._id }, { $set: set });
}

/**
 * One template: skips when already checked for this HEAL_VERSION. Returns { healed, changed } or { skipped }. Never throws.
 * options.force re-checks regardless of the marker; options.dryRun reports without writing.
 */
async function healTemplate(templateOrId, { force = false, dryRun = false } = {}) {
  let id;
  try {
    const template = templateOrId?.formFields ? templateOrId : await USCISFormTemplate.findById(templateOrId);
    if (!template) return { skipped: "not_found" };
    id = String(template._id);
    if (!force && !dryRun && alreadyChecked(template)) return { skipped: "already_checked" };
    if (inFlight.has(id)) return { skipped: "in_flight" };
    inFlight.add(id);
    const result = await computeChanges(template);
    if (dryRun) return { dryRun: true, ...result };
    // a copied-tooltip defect touches a handful of boxes; a large batch means the rules are misjudging this form, so nothing is written (and it is reported)
    if (result.changes.length > MAX_AUTO_CHANGES) {
      await USCISFormTemplate.updateOne({ _id: template._id }, { $set: { "pdfMetadata.labelHeal": { version: HEAL_VERSION, at: new Date(), changed: 0, heldForReview: result.changes.length } } });
      logger.info("uscis_form_label_heal_held", { formCode: template.formCode, templateId: id, proposed: result.changes.length });
      return { skipped: "too_many_changes", proposed: result.changes.length };
    }
    await applyChanges(template, result);
    if (result.changes.length) logger.info("uscis_form_labels_healed", { formCode: template.formCode, templateId: id, changed: result.changes.length });
    return { healed: true, changed: result.changes.length };
  } catch (error) {
    logger.info("uscis_form_label_heal_failed", { templateId: id, error: error.message });
    return { skipped: "error", error: error.message };
  } finally {
    if (id) inFlight.delete(id);
  }
}

/** Fire-and-forget after the caller already has its answer: a slow or failed heal can never delay or break a case manager's request. */
function scheduleHeal(template) {
  try {
    if (!template?._id || (template.pdfMetadata && alreadyChecked(template))) return;
    if (require("mongoose").connection.readyState !== 1) return; // no database connection (a DB-free test, a shutdown): nothing to heal against
    setImmediate(async () => {
      try {
        // a cheap marker lookup first: the full template (thousands of boxes on a big form) is loaded only when a check is really due
        if (await USCISFormTemplate.exists({ _id: template._id, "pdfMetadata.labelHeal.version": { $gte: HEAL_VERSION } })) return;
        await healTemplate(template._id);
      } catch (_error) { /* never surfaces */ }
    });
  } catch (_error) { /* bookkeeping only */ }
}

module.exports = { HEAL_VERSION, healTemplate, scheduleHeal, computeChanges, applyChanges, alreadyChecked };
