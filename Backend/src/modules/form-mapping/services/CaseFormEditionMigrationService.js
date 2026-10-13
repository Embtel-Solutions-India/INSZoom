// Moves the open CaseForms of an older USCIS edition onto a newer edition with NO data loss.
//   - every saved value (filledData / fieldValues / manualOverrides) is carried to the new edition's field matched by id, PDF field name, the
//     name without "#subform[n]." or a detected rename;
//   - a value whose field has no counterpart in the new edition is NOT dropped: it is archived on the CaseForm (editionMigrations[]) with its old
//     field id, so it can be seen and restored by a person;
//   - the case is then re-autofilled with the new mapping; manual edits are protected by manualOverrides, and any carried value the autofill left
//     blank is put back, so autofill can never blank something a person had saved;
//   - finalized / filed / locked forms are legal records and stay on the edition they were filed on.
// Returns counts that must reconcile: carried + archived === total, per case.
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const CaseForm = require("../../../models/CaseForm");
const FieldDiffService = require("../../uscis-lifecycle/services/FieldDiffService");
const MappingResolver = require("./MappingResolver");
const AutoFillService = require("./AutoFillService");

const FROZEN_STATUSES = ["finalized", "filed", "locked", "receipt_received", "archived"];

const fieldKeys = (field) => [field.fieldId, field.id, field.fieldName, field.pdfFieldName, field.normalizedName].filter(Boolean);
const stripSubform = (name) => String(name).replace(/#subform\[\d+\]\./g, "");
const isBlank = (value) => value === undefined || value === null || value === "" || value === false;
const isPlain = (value) => value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);

// leaves of a bag as [path, value]; a flat bag (dotted top-level keys) is its own leaves
function leaves(bag, prefix = "", forceFlat = false) {
  if (!isPlain(bag)) return [];
  const flat = forceFlat || (!prefix && Object.keys(bag).some((key) => key.includes(".")));
  const out = [];
  for (const [key, value] of Object.entries(bag)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!flat && isPlain(value) && Object.keys(value).length) out.push(...leaves(value, path));
    else out.push([path, value]);
  }
  return out;
}

function buildMatcher(oldTemplate, newTemplate) {
  const newByKey = new Map();
  const newByBase = new Map();
  (newTemplate.formFields || []).forEach((field) => {
    fieldKeys(field).forEach((key) => newByKey.set(key, field));
    newByBase.set(stripSubform(field.fieldName || ""), field);
  });
  const renamed = new Map();
  if (oldTemplate) {
    const diff = FieldDiffService.diff(oldTemplate.formFields || [], newTemplate.formFields || []);
    (diff.renamed || []).forEach((item) => {
      const target = (newTemplate.formFields || []).find((field) => fieldKeys(field).includes(item.newField?.id));
      if (target) fieldKeys(item.oldField || {}).forEach((key) => renamed.set(key, target));
    });
  }
  return (path) => newByKey.get(path) || newByBase.get(stripSubform(path)) || renamed.get(path);
}

function carryBag(bag, match, flatOutput, forceFlat) {
  const out = {};
  const archived = {};
  let carried = 0;
  const entries = leaves(bag, "", forceFlat);
  for (const [path, value] of entries) {
    const target = match(path);
    if (!target) { archived[path] = value; continue; }
    const targetId = target.fieldId || target.id || target.fieldName;
    if (flatOutput) out[targetId] = value; else MappingResolver.setPath(out, targetId, value);
    carried += 1;
  }
  return { out, archived, carried, total: entries.length };
}

async function migrateCaseFormsToEdition({ newTemplate, actor, req, formCode = newTemplate.formCode }) {
  const result = { considered: 0, migrated: 0, skippedFrozen: 0, valuesCarried: 0, valuesArchived: 0, valuesRestoredAfterAutofill: 0, failed: [] };
  const priorEditions = await USCISFormTemplate.find({ formCode, _id: { $ne: newTemplate._id } }).lean();
  const priorById = new Map(priorEditions.map((template) => [String(template._id), template]));
  // the form itself plus its component rows (e.g. the I-129 H / H-1B supplements are their own CaseForms that point at the same template)
  const caseForms = await CaseForm.find({ $or: [{ formCode }, { parentFormCode: formCode }], formTemplateId: { $in: [...priorById.keys()] } });
  result.considered = caseForms.length;

  for (const caseForm of caseForms) {
    if (caseForm.isLocked || FROZEN_STATUSES.includes(caseForm.status)) { result.skippedFrozen += 1; continue; }
    try {
      const previous = priorById.get(String(caseForm.formTemplateId));
      const match = buildMatcher(previous, newTemplate);
      const archive = { fromVersion: previous?.version, fromTemplateId: previous?._id, toVersion: newTemplate.version, migratedAt: new Date(), migratedBy: actor?._id, unmatchedValues: {} };
      let caseCarried = 0;
      let caseTotal = 0;
      let carriedFilled = {};
      for (const bagName of ["filledData", "fieldValues", "manualOverrides"]) {
        const original = caseForm[bagName];
        if (!original || typeof original !== "object") continue;
        const flatOutput = bagName !== "filledData" || Object.keys(original).some((key) => key.includes("."));
        const { out, archived, carried, total } = carryBag(JSON.parse(JSON.stringify(original)), match, flatOutput, bagName !== "filledData");
        caseCarried += carried; caseTotal += total;
        if (Object.keys(archived).length) archive.unmatchedValues[bagName] = archived;
        caseForm.set(bagName, out);
        caseForm.markModified(bagName);
        if (bagName === "filledData") carriedFilled = out;
        result.valuesArchived += total - carried;
      }
      const archivedCount = Object.values(archive.unmatchedValues).reduce((sum, bag) => sum + Object.keys(bag).length, 0);
      if (caseCarried + archivedCount !== caseTotal) throw new Error(`value count mismatch (${caseCarried}+${archivedCount} != ${caseTotal}); nothing was changed`);
      result.valuesCarried += caseCarried;

      caseForm.formTemplateId = newTemplate._id;
      caseForm.formVersion = newTemplate.version;
      caseForm.formEditionDate = newTemplate.editionDate;
      caseForm.mappingVersion = newTemplate.activeMappingVersion || 0;
      caseForm.mappingVersionId = newTemplate.activeMappingVersionId;
      caseForm.formVersionLock = {
        ...(caseForm.formVersionLock?.toObject?.() || caseForm.formVersionLock || {}),
        formType: formCode,
        editionDate: newTemplate.editionDate,
        version: newTemplate.version,
        mappingVersion: caseForm.mappingVersion,
        mappingVersionId: newTemplate.activeMappingVersionId,
        formTemplateId: newTemplate._id,
        migratedFrom: previous?._id,
        migratedAt: new Date(),
        migratedBy: actor?._id,
      };
      caseForm.editionMigrations = [...(caseForm.editionMigrations || []), archive];
      caseForm.markModified("editionMigrations");
      caseForm.auditHistory?.push({ action: "EDITION_MIGRATED", changes: { from: previous?.version, to: newTemplate.version, carried: caseCarried, archived: archivedCount }, performedBy: actor?._id });
      await caseForm.save();

      await AutoFillService.generate(caseForm.caseId, caseForm.formCode, actor, req || { ip: "system", headers: {} }, { regenerate: true }).catch((error) => {
        result.failed.push({ caseFormId: String(caseForm._id), stage: "autofill", error: error.message });
      });
      // never let autofill blank a value a person had saved
      const after = await CaseForm.findById(caseForm._id);
      let restored = 0;
      for (const [path, value] of leaves(carriedFilled)) {
        if (!isBlank(value) && isBlank(MappingResolver.resolvePath(after.filledData || {}, path) ?? (after.filledData || {})[path])) {
          if (path.includes(".") && !(after.filledData || {})[path] && Object.keys(after.filledData || {}).some((key) => key.includes("."))) after.filledData[path] = value;
          else MappingResolver.setPath(after.filledData, path, value);
          restored += 1;
        }
      }
      if (restored) { after.markModified("filledData"); await after.save(); result.valuesRestoredAfterAutofill += restored; }
      result.migrated += 1;
    } catch (error) {
      result.failed.push({ caseFormId: String(caseForm._id), stage: "migrate", error: error.message });
    }
  }
  return result;
}

module.exports = { migrateCaseFormsToEdition, FROZEN_STATUSES };
