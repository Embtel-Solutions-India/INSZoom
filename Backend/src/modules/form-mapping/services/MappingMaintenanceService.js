// Keeps the mapping of LIVE forms in step with the owner's decisions and removes states that only mean "nobody finished this", run by the 12-hour catalog sync (USCISCatalogSyncJob).
//
//   1. applyDecidedSpecs  - a form whose parties the owner decided (config/partyFormSpecs.js) gets those decisions applied to its LIVE template, not only when a new edition is imported.
//                           PartyFieldMappingService.apply is idempotent (nothing to change = nothing saved) and activates only a mapping that validates.
//   2. activateReadyDrafts - a live form whose latest saved mapping version is a complete, valid DRAFT (every box mapped and approved, no review edge, contract-valid) that was simply never
//                           activated is activated through the normal gated MappingGraphService.activate. That version is already the one autofill reads; activating it only makes the form's
//                           status say so ("Draft mapping" -> "Fully mapped"). A draft with any review item or any error is never touched.
//   3. labelNoMappingForms - a form with nothing for a case to fill (config NO_MAPPING_FORMS: a fee schedule) is "Fully mapped": it has no mapping to be incomplete.
//   4. registerContinuationSheets - a continuation sheet of a form (I-129 Attachment-1) carries its owner-given name and is listed, conditionally, for every visa type that files the form.
//
// Fail-safe: never throws, every step is bounded and reports what it did; FORM_MAPPING_MAINTENANCE=false switches it off.
const logger = require("../../../utils/logger");
const { PARTY_FORM_SPECS, NO_MAPPING_FORMS } = require("../config/partyFormSpecs");

const model = (name) => require(`../../../models/${name}`);
const enabled = (env = process.env) => String(env.FORM_MAPPING_MAINTENANCE || "true").toLowerCase() !== "false";
const actor = () => require("../../form-pipeline/systemActor").systemActor();
const request = (id) => ({ headers: {}, ip: "pipeline", requestId: id });

async function liveTemplate(formCode) {
  return model("USCISFormTemplate").findOne({ formCode, status: "active" }).sort({ editionDate: -1 });
}

/** 1. Apply the owner's decided parties to every live form that has a spec. */
async function applyDecidedSpecs({ dryRun = false, only } = {}) {
  const PartyFieldMappingService = require("./PartyFieldMappingService");
  const results = [];
  for (const formCode of Object.keys(PARTY_FORM_SPECS).filter((code) => !only?.length || only.includes(code))) {
    try {
      const template = await liveTemplate(formCode);
      if (!template) continue;
      const report = await PartyFieldMappingService.apply(template, actor(), request("mapping-maintenance"), { dryRun, allowInference: false });
      if (report.skipped) continue;
      const changed = Number(report.created || 0) + Number(report.rewired || 0) + Number(report.removed || 0) + Number(report.mirrored || 0);
      if (changed || report.saved || report.error) results.push({ formCode, changed, saved: Boolean(report.saved), activated: Boolean(report.activated), error: report.error || null });
    } catch (error) {
      results.push({ formCode, error: error.message });
      logger.warn("mapping_maintenance_spec_failed", { formCode, error: error.message });
    }
  }
  return results;
}

/** 2. Activate a complete, valid draft that was never activated. */
async function activateReadyDrafts({ dryRun = false, only } = {}) {
  const MappingGraphService = require("./MappingGraphService");
  const USCISMappingVersion = model("USCISMappingVersion");
  const results = [];
  const live = await model("USCISFormTemplate").find({ status: "active", mappingStatus: "draft", ...(only?.length ? { formCode: { $in: only } } : {}) });
  for (const template of live) {
    const label = { formCode: template.formCode, version: template.version };
    try {
      const latest = await USCISMappingVersion.findOne({ template: template._id, mappingVersion: template.mappingVersion }).select("mappingVersion status graph validation").lean();
      if (!latest || latest.status !== "draft") { results.push({ ...label, skipped: "the latest mapping version is not a draft" }); continue; }
      const verdict = await MappingGraphService.validateWithContract(latest.graph, template);
      const reviewEdges = (latest.graph?.edges || []).filter((edge) => edge.status !== "active").length;
      if (!verdict.readyForActivation || (verdict.errors || []).length || reviewEdges) { results.push({ ...label, skipped: "not complete and valid (review items or errors remain)" }); continue; }
      if (dryRun) { results.push({ ...label, wouldActivate: `v${latest.mappingVersion}` }); continue; }
      try {
        await MappingGraphService.activate(template._id, actor(), request("mapping-maintenance"));
      } catch (error) {
        // the edition-diff gate wants a reviewer: the pipeline's own acknowledgement (FormEditionComparisonService.autoAcknowledge - ONLY a diff it can prove safe, recorded as a machine decision, needs
        // FORM_PIPELINE_AUTONOMY on) is tried once; anything it cannot prove stays for a person
        if (error.code !== "UNREVIEWED_EDITION_CHANGES") throw error;
        const acknowledgement = await require("./FormEditionComparisonService").autoAcknowledge(template).catch((failure) => ({ acknowledged: false, reason: failure.message }));
        if (!acknowledgement.acknowledged) { results.push({ ...label, needsPerson: `the edition changes are not provably safe to acknowledge automatically (${acknowledgement.reason})` }); continue; }
        await MappingGraphService.activate(template._id, actor(), request("mapping-maintenance"));
      }
      results.push({ ...label, activated: `v${latest.mappingVersion}` });
      logger.info("mapping_maintenance_draft_activated", { formCode: template.formCode, mappingVersion: latest.mappingVersion });
    } catch (error) {
      results.push({ ...label, error: error.message });
      logger.warn("mapping_maintenance_activate_failed", { formCode: template.formCode, error: error.message });
    }
  }
  return results;
}

/** 3. Forms with nothing to map read "Fully mapped". */
async function labelNoMappingForms({ dryRun = false } = {}) {
  const USCISFormTemplate = model("USCISFormTemplate");
  const stale = await USCISFormTemplate.find({ status: "active", formCode: { $in: [...NO_MAPPING_FORMS] }, mappingStatus: { $ne: "active" } }).select("formCode mappingStatus").lean();
  if (!dryRun && stale.length) await USCISFormTemplate.updateMany({ _id: { $in: stale.map((item) => item._id) } }, { $set: { mappingStatus: "active" } }, { timestamps: false });
  return stale.map((item) => ({ formCode: item.formCode, was: item.mappingStatus }));
}

/** 4. Continuation sheets (I-129 Attachment-1, config/continuationSheets.js): the slice carries its owner-given name, and a CONDITIONAL registry row lists it for every visa type that files the parent form. */
async function registerContinuationSheets({ dryRun = false } = {}) {
  const { CONTINUATION_SHEETS } = require("../config/continuationSheets");
  const Definitions = model("USCISFormComponentDefinition");
  const Rows = model("VisaFormMapping");
  const report = [];
  for (const sheet of CONTINUATION_SHEETS) {
    const stale = await Definitions.find({ parentFormCode: sheet.parentForm, componentCode: sheet.componentCode, name: { $ne: sheet.name } }).select("_id").lean();
    if (!dryRun && stale.length) await Definitions.updateMany({ _id: { $in: stale.map((item) => item._id) } }, { $set: { name: sheet.name } });
    const parents = await Rows.find({ formNumber: sheet.parentForm, componentType: "STANDALONE_FORM", active: true }).lean();
    const listed = new Set((await Rows.find({ formNumber: sheet.formNumber }).select("visaType").lean()).map((row) => row.visaType));
    const missing = parents.filter((parent) => !listed.has(parent.visaType));
    if (!dryRun) {
      for (const parent of missing) {
        await Rows.updateOne({ visaType: parent.visaType, formNumber: sheet.formNumber }, {
          $setOnInsert: {
            visaType: parent.visaType, visaCategory: parent.visaCategory, caseType: parent.caseType, immigrationNature: parent.immigrationNature, agency: parent.agency || "USCIS",
            formNumber: sheet.formNumber, formName: sheet.name, provisioningType: "CONDITIONAL", processingPaths: [], triggerCondition: null, initialCaseCreation: false, stage: "",
            parentForm: sheet.parentForm, componentType: "FORM_COMPONENT", componentCode: sheet.componentCode, formTemplateFormCode: null, displayOrder: sheet.displayOrder, active: true,
            sourceVerified: false, notes: sheet.notes,
          },
        }, { upsert: true });
      }
    }
    report.push({ componentCode: sheet.componentCode, renamed: stale.length, rowsAdded: missing.length });
  }
  return report;
}

/** All four, in order. Never throws. */
async function runAll({ dryRun = false } = {}) {
  const summary = { specs: [], drafts: [], noMapping: [], sheets: [] };
  if (!enabled()) return { skipped: "disabled" };
  for (const [key, step] of [["specs", applyDecidedSpecs], ["drafts", activateReadyDrafts], ["noMapping", labelNoMappingForms], ["sheets", registerContinuationSheets]]) {
    try { summary[key] = await step({ dryRun }); } catch (error) { logger.warn("mapping_maintenance_step_failed", { step: key, error: error.message }); }
  }
  try { require("../../uscis-forms/uscis-form.service").invalidateTemplateCache(); } catch (_error) { /* cache only */ }
  return summary;
}

module.exports = { runAll, applyDecidedSpecs, activateReadyDrafts, labelNoMappingForms, registerContinuationSheets, enabled };
