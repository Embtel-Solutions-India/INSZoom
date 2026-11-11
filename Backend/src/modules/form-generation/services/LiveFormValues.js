// LiveFormValues - a download must contain every value the live form view (Immiglance / Admin editor) shows.
//
// Root cause found by auditing every case form (2026-11-11): the view recomputes each box from the case's CURRENT canonical profile and the live mapping, but a download is
// built from the values SAVED on the form at the last auto-fill. A box the saved copy never received (a name repeated on a continuation sheet, a copy of a box on another
// page, an answer that reached the case after the last fill, a mapping added later) therefore shows in the view and is blank in the downloaded PDF - and nothing flagged the
// form as out of date. 12 of 78 case forms (I-129, I-907, G-1145, G-1650, supplements) had such boxes, 52 in total.
//
// The fix is a gap-fill done at download time, in memory only (nothing is saved, nothing existing is changed):
//   * for every box where the live view has a value and the saved copy has none, the live value is used;
//   * a box the saved copy already has a value for is NEVER touched, and neither is a box a person edited / approved / overrode (AutoFillService.isReviewedOrManual);
//   * a locked or filed form is a historical record and is not gap-filled.
// Every type of box is covered (text, number, date, checkbox, radio, dropdown) because it works on the form's values, not on box kinds. Never throws: any failure
// returns the saved copy unchanged plus a reason, so a download is never made to fail by this step.
const MappingResolver = require("../../form-mapping/services/MappingResolver");

const significant = (value) => {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "" && value.trim().toLowerCase() !== "false";
  if (Array.isArray(value)) return value.some(significant);
  return true;
};

const plain = (value) => {
  if (!value) return {};
  const raw = typeof value.toObject === "function" ? value.toObject() : value;
  return JSON.parse(JSON.stringify(raw));
};

/** A read-only view of the form whose filledData is the gap-filled copy; every other property (and every method) is the original form's. Nothing here is saved. */
function withFilledData(caseForm, filledData) {
  const view = Object.create(caseForm);
  Object.defineProperty(view, "filledData", { value: filledData, enumerable: true, configurable: true, writable: true });
  return view;
}

/**
 * @returns {{ filledData: object|null, filledFieldIds: string[], skipped: string|null }}
 *   filledData is null when nothing was added (use the saved copy as it is).
 */
async function gapFill({ caseForm, template, user, req }, deps = {}) {
  const result = { filledData: null, filledFieldIds: [], restoredFieldIds: [], skipped: null };
  try {
    if (!caseForm?.caseId || !template) { result.skipped = "no case or template"; return result; }
    if (caseForm.isLocked || ["locked", "filed"].includes(caseForm.status)) { result.skipped = "historical form"; return result; }
    const mongoose = require("mongoose");
    if (!deps.Case && mongoose.connection.readyState !== 1) { result.skipped = "no database connection"; return result; }
    const CaseModel = deps.Case || require("../../../models/Case");
    // Only a profile that is already built is read (a rebuild would write); a case that was never auto-filled has none and simply keeps its saved values.
    const cached = await CaseModel.findById(caseForm.caseId).select("canonicalProfile.lastBuiltAt").lean();
    if (!cached?.canonicalProfile?.lastBuiltAt) { result.skipped = "no cached canonical profile"; return result; }

    const FormMappingService = deps.FormMappingService || require("../../form-mapping/services/FormMappingService");
    const CanonicalDataService = deps.CanonicalDataService || require("../../form-mapping/services/CanonicalDataService");
    const AutoFillService = deps.AutoFillService || require("../../form-mapping/services/AutoFillService");

    const mappingVersion = await FormMappingService.loadMappingVersion(template, undefined);
    const mappedTemplate = FormMappingService.applyMappingGraph(template, mappingVersion);
    const canonicalData = await CanonicalDataService.build(caseForm.caseId, user, req, { skipRebuild: true, reason: "download_gap_fill" });
    const mapped = FormMappingService.mapTemplate(mappedTemplate, canonicalData);

    // a supplement (component) form only ever holds its own boxes
    let scope = null;
    if (caseForm.componentCode) {
      const Definition = deps.USCISFormComponentDefinition || require("../../../models/USCISFormComponentDefinition");
      const definition = await Definition.findOne({ parentTemplateId: template._id, componentCode: caseForm.componentCode, status: "ACTIVE" }).select("fieldIds").lean();
      if (!definition?.fieldIds?.length) { result.skipped = "component boxes unknown"; return result; }
      scope = new Set(definition.fieldIds);
    }

    const saved = plain(caseForm.filledData);
    const filled = JSON.parse(JSON.stringify(saved));
    const overrides = plain(caseForm.manualOverrides);
    const overrideOf = (fieldId) => overrides[fieldId] || MappingResolver.resolvePath(overrides, fieldId);
    // A "manual override" whose value is EMPTY is not an answer a person gave: the native PDF editor records one whenever a box is committed blank (the viewer's own copy of
    // a mirrored/continuation box is blank), and it wiped real values - 58 boxes on 18 forms, 29 of which had held a value (e.g. a Given Name "Jennifer", ticked "Yes"
    // boxes). Such an override never blanks a box in the download: the live value, or the value the box held before it was blanked, is used.
    const isEmptyOverride = (fieldId) => { const meta = overrideOf(fieldId); return Boolean(meta) && typeof meta === "object" && "value" in meta && !significant(meta.value); };
    const protectedByPerson = (fieldId) => {
      if (isEmptyOverride(fieldId)) return false;
      try { return AutoFillService.isReviewedOrManual(caseForm, fieldId); } catch (_error) { return false; }
    };
    const put = (fieldId, value, restored) => {
      MappingResolver.setPath(filled, fieldId, value);
      result.filledFieldIds.push(fieldId);
      if (restored) result.restoredFieldIds.push(fieldId);
    };
    for (const [fieldId, value] of Object.entries(mapped.fieldValues || {})) {
      if (!significant(value) || (scope && !scope.has(fieldId))) continue;
      if (significant(MappingResolver.resolvePath(saved, fieldId))) continue; // the saved copy has it: never touched
      if (protectedByPerson(fieldId)) continue; // a person edited / approved this box with a real answer
      put(fieldId, value, isEmptyOverride(fieldId));
    }
    // staff-edited boxes: a value a person typed is ALWAYS written (even if the saved copy ever lacks it); a box blanked by an empty override that the live view has
    // nothing for gets back the value it held before it was blanked
    for (const [fieldId, meta] of Object.entries(overrides)) {
      if (!meta || typeof meta !== "object" || !("value" in meta)) continue;
      if (scope && !scope.has(fieldId)) continue;
      if (result.filledFieldIds.includes(fieldId)) continue;
      const current = MappingResolver.resolvePath(saved, fieldId);
      if (significant(meta.value)) {
        // what a person typed is final: written when the saved copy lacks it, and it also wins over an OLDER saved text (e.g. the edit reached the override record but not
        // the saved values). Ticks / booleans are never swapped for text.
        const older = significant(current) && typeof current === "string" && typeof meta.value === "string" && current.replace(/\s+/g, "").toLowerCase() !== meta.value.replace(/\s+/g, "").toLowerCase();
        if (!significant(current) || older) put(fieldId, meta.value, true);
      } else if (!significant(current) && significant(meta.previousValue)) put(fieldId, meta.previousValue, true);
    }
    if (result.filledFieldIds.length) result.filledData = filled;
  } catch (error) {
    result.skipped = `could not compute the live values (${error.message})`;
    result.filledData = null;
    result.filledFieldIds = [];
    result.restoredFieldIds = [];
  }
  return result;
}

module.exports = { gapFill, withFilledData, significant };
