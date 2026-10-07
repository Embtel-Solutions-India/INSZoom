// node src/scripts/replaceFormEdition.js --formCode I-485 --toVersion 2026-09-18 [--apply]
// (or: npm run replace:form-edition -- --formCode I-485 --toVersion 2026-09-18 --apply, from Backend/)
//
// Replaces the ACTIVE edition of a USCIS form with a newer, already-imported edition (import it first with
// `npm run import:form` / the form's seed) WITHOUT losing anything that depended on the old one:
//   1. the new edition's mapping graph is built and activated BEFORE it goes live (per-form hook below - the reviewed
//      crosswalk, never a guess), so it autofills from the same client data as the old edition did;
//   2. the new edition becomes the active template (visaTypes carried over + registry-derived) and the old one is
//      retired (kept, never deleted);
//   3. every existing, still-open CaseForm of the old edition is re-pointed at the new template, its saved values are
//      carried over by field name, and it is re-autofilled with the new mapping - so cases already in flight now open,
//      autofill, edit and download on the NEW form. Finalized / filed / locked forms are legal records and stay on the
//      edition they were filed on (reported, not touched).
// Dry run by default; --apply writes. --acknowledgeEditionChanges records the human review the edition-change gate needs. Idempotent: re-running after a successful run changes nothing.
const mongoose = require("mongoose");
const env = require("../config/env");
const USCISFormTemplate = require("../models/USCISFormTemplate");
const USCISMappingVersion = require("../models/USCISMappingVersion");
const CaseForm = require("../models/CaseForm");
const User = require("../models/User");
const FieldDiffService = require("../modules/uscis-lifecycle/services/FieldDiffService");
const FormEditionComparisonService = require("../modules/form-mapping/services/FormEditionComparisonService");
const AutoFillService = require("../modules/form-mapping/services/AutoFillService");
const { deriveVisaTypesFromRegistry } = require("../modules/uscis-form-import/seeds/deriveVisaTypesFromRegistry");

// formCode -> the reviewed mapping seed that can target a specific (not-yet-active) template.
const MAPPING_HOOKS = {
  "I-485": () => require("../modules/form-mapping/seeds/i485-perm-mapping.seed"),
};

// Legal-record statuses: never moved off the edition they were generated/filed on.
const FROZEN_STATUSES = ["finalized", "filed", "approved", "generated", "ready_for_pdf", "locked", "receipt_received"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const next = argv[i + 1];
    args[argv[i].slice(2)] = next && !next.startsWith("--") ? next : true;
  }
  return args;
}

const fieldKeys = (field) => [field.fieldId, field.id, field.fieldName, field.pdfFieldName, field.normalizedName].filter(Boolean);
const stripSubform = (name) => String(name).replace(/#subform\[\d+\]\./g, "");

async function run({ formCode, toVersion, apply, acknowledgeEditionChanges }) {
  const newTemplate = await USCISFormTemplate.findOne({ formCode, version: toVersion });
  if (!newTemplate) throw new Error(`No ${formCode} ${toVersion} template - import it first.`);
  const oldTemplates = await USCISFormTemplate.find({ formCode, _id: { $ne: newTemplate._id }, status: "active" });
  const summary = {
    formCode,
    from: oldTemplates.map((t) => t.version),
    to: toVersion,
    fieldDiff: null,
    mapping: null,
    activated: false,
    retired: [],
    caseForms: { considered: 0, migrated: 0, skippedFrozen: 0, valuesCarried: 0, valuesDropped: 0, failed: [] },
  };
  if (!oldTemplates.length && newTemplate.status === "active") summary.alreadyReplaced = true;

  const reference = oldTemplates[0];
  if (reference) {
    const diff = FieldDiffService.diff(reference.formFields || [], newTemplate.formFields || []);
    summary.fieldDiff = { added: diff.added?.length ?? null, removed: diff.removed?.length ?? null, renamed: diff.renamed?.length ?? null, modified: diff.modified?.length ?? null };
  }
  if (!apply) return summary;

  const actor = (await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 })) || { _id: undefined, role: "super_admin" };

  // 1. Map the new edition BEFORE it is live.
  const hook = MAPPING_HOOKS[formCode];
  if (!hook) throw new Error(`No reviewed mapping hook registered for ${formCode} in replaceFormEdition.js - add one before replacing this form.`);
  // Edition-change governance (Phase 3J) blocks mapping activation when the new edition removed/renamed fields that
  // the previous edition's mapping used. The reviewed crosswalk hook above re-targets those edges to the new field
  // names, so a human-reviewed run passes --acknowledgeEditionChanges to record that acknowledgement (audited).
  if (acknowledgeEditionChanges) await FormEditionComparisonService.acknowledge(newTemplate._id, actor, null);
  const seeded = await hook()({ user: actor, template: await USCISFormTemplate.findById(newTemplate._id) });
  summary.mapping = { mappingVersion: seeded.mappingVersion?.mappingVersion, mappedEdges: seeded.graph.edges.length, classification: seeded.classification };

  // 2. Swap the active edition.
  const fresh = await USCISFormTemplate.findById(newTemplate._id);
  const registryVisaTypes = await deriveVisaTypesFromRegistry(formCode);
  const carriedVisaTypes = oldTemplates.flatMap((t) => t.visaTypes || []);
  fresh.visaTypes = Array.from(new Set([...(fresh.visaTypes || []), ...carriedVisaTypes, ...registryVisaTypes]));
  fresh.status = "active";
  fresh.activeFlag = true;
  fresh.officialStatus = "current";
  fresh.currentStatus = "active";
  fresh.approvedAt = fresh.approvedAt || new Date();
  fresh.approvedBy = fresh.approvedBy || actor._id;
  fresh.activatedAt = new Date();
  await fresh.save();
  summary.activated = true;
  for (const old of oldTemplates) {
    old.status = "retired";
    old.currentStatus = "retired";
    old.activeFlag = false;
    old.officialStatus = "deprecated";
    old.retiredAt = new Date();
    await old.save();
    summary.retired.push(old.version);
  }

  // 3. Move open CaseForms onto the new edition and re-autofill them.
  const finalTemplate = await USCISFormTemplate.findById(fresh._id).lean();
  const activeVersion = finalTemplate.activeMappingVersionId ? await USCISMappingVersion.findById(finalTemplate.activeMappingVersionId).lean() : null;
  const newKeyIndex = new Map();
  const newBaseIndex = new Map();
  (finalTemplate.formFields || []).forEach((field) => {
    fieldKeys(field).forEach((key) => newKeyIndex.set(key, field));
    newBaseIndex.set(stripSubform(field.fieldName), field);
  });
  const priorEditions = await USCISFormTemplate.find({ formCode, _id: { $ne: newTemplate._id } }).select("_id").lean();
  const oldIds = priorEditions.map((t) => t._id);
  const caseForms = await CaseForm.find({ formCode, formTemplateId: { $in: oldIds } });
  summary.caseForms.considered = caseForms.length;
  for (const caseForm of caseForms) {
    // (formVersionLock.lockedBy only records who pinned the edition at creation - it is not a "form locked" flag.)
    if (FROZEN_STATUSES.includes(caseForm.status)) {
      summary.caseForms.skippedFrozen += 1;
      continue;
    }
    try {
      const migrate = (bag = {}) => {
        const out = {};
        Object.entries(bag || {}).forEach(([key, value]) => {
          const target = newKeyIndex.get(key) || newBaseIndex.get(stripSubform(key));
          if (target) {
            out[fieldKeys(target).includes(key) ? key : (target.fieldId || target.id || target.fieldName)] = value;
            summary.caseForms.valuesCarried += 1;
          } else {
            summary.caseForms.valuesDropped += 1;
          }
        });
        return out;
      };
      const previousTemplateId = caseForm.formTemplateId;
      caseForm.fieldValues = migrate(caseForm.fieldValues);
      caseForm.filledData = migrate(caseForm.filledData);
      caseForm.manualOverrides = migrate(caseForm.manualOverrides);
      caseForm.formTemplateId = finalTemplate._id;
      caseForm.formVersion = finalTemplate.version;
      caseForm.formEditionDate = finalTemplate.editionDate;
      caseForm.mappingVersion = finalTemplate.activeMappingVersion || activeVersion?.mappingVersion || 0;
      caseForm.mappingVersionId = finalTemplate.activeMappingVersionId;
      caseForm.formVersionLock = {
        ...(caseForm.formVersionLock?.toObject?.() || caseForm.formVersionLock || {}),
        formType: formCode,
        editionDate: finalTemplate.editionDate,
        version: finalTemplate.version,
        mappingVersion: caseForm.mappingVersion,
        mappingVersionId: finalTemplate.activeMappingVersionId,
        formTemplateId: finalTemplate._id,
        migratedFrom: previousTemplateId,
        migratedAt: new Date(),
        migratedBy: actor._id,
      };
      caseForm.markModified("fieldValues");
      caseForm.markModified("filledData");
      caseForm.markModified("manualOverrides");
      await caseForm.save();
      // Re-autofill on the new edition; manual edits carried above are never overwritten by autofill.
      await AutoFillService.generate(caseForm.caseId, formCode, actor, { ip: "script", headers: {}, requestId: "replaceFormEdition" }, {}).catch((error) => {
        summary.caseForms.failed.push({ caseFormId: String(caseForm._id), stage: "autofill", error: error.message });
      });
      summary.caseForms.migrated += 1;
    } catch (error) {
      summary.caseForms.failed.push({ caseFormId: String(caseForm._id), stage: "migrate", error: error.message });
    }
  }
  return summary;
}

module.exports = run;

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.formCode || !args.toVersion) {
    console.error("Usage: node src/scripts/replaceFormEdition.js --formCode I-485 --toVersion 2026-09-18 [--apply]");
    process.exit(1);
  }
  mongoose
    .connect(env.mongoUri)
    .then(() => run({ formCode: String(args.formCode).toUpperCase(), toVersion: String(args.toVersion), apply: Boolean(args.apply), acknowledgeEditionChanges: Boolean(args.acknowledgeEditionChanges) }))
    .then((summary) => {
      console.log(args.apply ? "Edition replacement APPLIED:" : "Edition replacement DRY RUN (use --apply to write):");
      console.log(JSON.stringify(summary, null, 2));
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("Edition replacement failed:", error.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
