// Form pipeline autopilot: keeps the form registry, mappings and certification correct from code, with no manual script run. Triggered by the server at start
// and on an interval (server.js), and safe to call any time (every step is idempotent, lock-guarded and never throws into the caller).
//
//   1. registry gap-fill   seed rows / checklist mappings for visa types the DB does not have at all (never overwrites an existing row - a hand-tuned or older
//                          row is left exactly as it is)
//   2. component linking   FORM_COMPONENT / SUPPLEMENT rows without a componentCode get linked by the existing slicing discovery
//   3. per-form readiness  every form with authored rules: scope its visa types from the registry, build the mapping from the rules (retried), certify the active
//                          edition (FormCertificationService) - skipped when the stored certification already passed for this exact edition + mapping
// The result of every run is returned (and logged) so a failure is visible, never silent.
const VisaFormMapping = require("../../models/VisaFormMapping");
const USCISFormTemplate = require("../../models/USCISFormTemplate");
const User = require("../../models/User");
const logger = require("../../utils/logger");
const { retryUntilSuccess } = require("../../utils/resilientRetry");

async function syncMissingRegistry() {
  const { mappings } = require("./seeds/visaFormMappings.seed");
  const { ENTRIES } = require("./seeds/checklistMappings.seed");
  const present = new Set(await VisaFormMapping.distinct("visaType"));
  const missing = new Set(mappings.map((mapping) => mapping.visaType).filter((visaType) => !present.has(visaType)));
  let created = 0;
  for (const mapping of mappings.filter((item) => missing.has(item.visaType))) {
    await VisaFormMapping.updateOne(
      { visaType: mapping.visaType, formNumber: mapping.formNumber, componentType: mapping.componentType },
      { $setOnInsert: mapping },
      { upsert: true }
    );
    created += 1;
  }
  // checklist mappings only for the rows just created, or existing rows that have none yet - an existing non-empty list is never replaced
  let checklistFilled = 0;
  for (const entry of ENTRIES) {
    const result = await VisaFormMapping.updateOne(
      { visaType: entry.visaType, formNumber: entry.formNumber, $or: [{ checklistMappings: { $exists: false } }, { checklistMappings: { $size: 0 } }] },
      { $set: { checklistMappings: entry.checklistMappings } }
    );
    checklistFilled += result.modifiedCount || 0;
  }
  return { missingVisaTypes: [...missing], rowsEnsured: created, checklistFilled };
}

// A form imported before editions were always recorded can have a date-shaped version ("2026-09-15") but no editionDate. Copy it over (yyyy-mm-dd only; anything that is
// not a clean date is left alone) so the catalog sync can compare it. Never overwrites an existing editionDate.
async function backfillEditionDates() {
  const rows = await USCISFormTemplate.find({ status: "active", $or: [{ editionDate: null }, { editionDate: { $exists: false } }] }).select("formCode version");
  let filled = 0;
  for (const row of rows) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.version || ""))) continue;
    const date = new Date(`${row.version}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) continue;
    await USCISFormTemplate.updateOne({ _id: row._id, $or: [{ editionDate: null }, { editionDate: { $exists: false } }] }, { $set: { editionDate: date, "importMetadata.editionDateSource": "version_backfill" } });
    filled += 1;
  }
  return { candidates: rows.length, filled };
}

// Forms fetched automatically before the naming rule existed are stored as ".../form.pdf". Copy each to ".../<form>_<yyyy-mm-dd>.pdf" (the edition date), verify the copy
// byte for byte, and only then point the template at it. The old object is kept (nothing is deleted), so any older reference still resolves. Hand-uploaded and scanner
// forms are not touched.
async function normalizeStoredFileNames() {
  const storageService = require("../uploads/storage.service");
  const crypto = require("crypto");
  const rows = await USCISFormTemplate.find({ status: "active", pdfStorageKey: /\/form\.pdf$/, "importMetadata.source": { $in: ["on_demand_acquisition", "system_download"] } });
  const report = { candidates: rows.length, renamed: [], failed: [] };
  for (const row of rows) {
    try {
      const date = row.editionDate ? row.editionDate.toISOString().slice(0, 10) : /^\d{4}-\d{2}-\d{2}$/.test(String(row.version)) ? row.version : null;
      if (!date) { report.failed.push(`${row.formCode}: no edition date`); continue; }
      const name = `${String(row.formCode).toLowerCase().replace(/[^a-z0-9-]+/g, "-")}_${date}.pdf`;
      const newKey = row.pdfStorageKey.replace(/form\.pdf$/, name);
      const buffer = await storageService.readBuffer(row.pdfStorageKey);
      const stored = await storageService.storeImmutableBuffer(newKey, buffer);
      const copy = await storageService.readBuffer(stored.key);
      if (crypto.createHash("sha256").update(copy).digest("hex") !== crypto.createHash("sha256").update(buffer).digest("hex")) throw new Error("copy does not match the original");
      row.pdfStorageKey = stored.key;
      if (stored.path) { row.pdfTemplatePath = stored.path; row.localPdfPath = stored.path; }
      row.set("artifacts.form.storageKey", stored.key);
      if (stored.path) row.set("artifacts.form.storagePath", stored.path);
      await row.save();
      report.renamed.push(`${row.formCode} -> ${name}`);
    } catch (error) {
      report.failed.push(`${row.formCode}: ${error.message}`);
    }
  }
  if (report.renamed.length) require("../uscis-forms/uscis-form.service").invalidateTemplateCache?.();
  return report;
}

async function linkComponents() {
  const unlinked = await VisaFormMapping.countDocuments({ active: true, componentType: "FORM_COMPONENT", $or: [{ componentCode: null }, { componentCode: { $exists: false } }] });
  if (!unlinked) return { unlinked: 0 };
  const { discoverAllRegistryComponents } = require("../uscis-forms/services/USCISFormComponentDiscoveryService");
  const results = await discoverAllRegistryComponents();
  return { unlinked, parentForms: results.length, failed: results.filter((item) => item.error).length };
}

async function readinessForForm(formCode, actor) {
  // visa scope from the registry first (add-only): also covers assignmentRules.visaTypes, which is authoritative whenever it is set
  await require("./template-scope-sync.service").syncTemplateScopeSafely(formCode);
  const template = await USCISFormTemplate.findOne({ formCode, status: "active" }).sort({ editionDate: -1 });
  if (!template) return { formCode, skipped: "no active template" };
  const certification = template.importMetadata?.validationSummary?.certification;
  const { deriveVisaTypesFromRegistry } = require("../uscis-form-import/seeds/deriveVisaTypesFromRegistry");
  const derived = await deriveVisaTypesFromRegistry(formCode);
  const merged = Array.from(new Set([...(template.visaTypes || []), ...derived]));
  const scopeChanged = merged.length !== (template.visaTypes || []).length;
  if (scopeChanged) { template.visaTypes = merged; await template.save(); require("../uscis-forms/uscis-form.service").invalidateTemplateCache?.(); }
  if (!scopeChanged && certification?.passed && certification.version === template.version && template.mappingStatus === "active") return { formCode, skipped: "already certified" };
  const PartyFieldMappingService = require("../form-mapping/services/PartyFieldMappingService");
  const FormCertificationService = require("../form-mapping/services/FormCertificationService");
  const MappingGraphService = require("../form-mapping/services/MappingGraphService");
  await FormCertificationService.backupTemplate(template, await MappingGraphService.loadCurrentGraph(template).catch(() => null));
  const mapping = await retryUntilSuccess(() => PartyFieldMappingService.apply(template, actor, { ip: "autopilot", headers: {} }), { attempts: 4, label: `rules:${formCode}` });
  const fresh = await USCISFormTemplate.findById(template._id);
  const report = await FormCertificationService.certify(fresh);
  return { formCode, mappingSaved: Boolean(mapping.saved), activated: Boolean(mapping.activated), certified: report.passed, failed: report.checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`) };
}

async function runOnce() {
  const summary = { registry: null, components: null, forms: [] };
  const step = async (name, task) => { try { return await task(); } catch (error) { logger.error("form_autopilot_step_failed", { step: name, error: error.message }); return { error: error.message }; } };
  summary.registry = await step("registry", syncMissingRegistry);
  summary.editions = await step("editions", backfillEditionDates);
  summary.fileNames = await step("fileNames", normalizeStoredFileNames);
  summary.components = await step("components", linkComponents);
  const actor = (await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 })) || { role: "super_admin" };
  const { RULES } = require("../form-mapping/config/partyFieldRules");
  // only forms whose rules are EXCLUSIVE (verified, rule-complete) are rebuilt automatically; the older rule sets were applied by hand and stay as they are
  const { EXCLUSIVE_FORMS } = require("../form-mapping/config/partyFieldRules");
  for (const formCode of Object.keys(RULES).filter((code) => EXCLUSIVE_FORMS.has(code))) {
    summary.forms.push(await step(`form:${formCode}`, () => readinessForForm(formCode, actor)));
  }
  logger.info("form_autopilot_completed", summary);
  return summary;
}

// Phase 5: the run is recorded for the governance overview AFTER it finishes; recording is fail-safe and never changes the run or its result
async function run() {
  let governance = null;
  try { governance = require("../form-governance/GovernanceRecorder"); } catch { /* governance bookkeeping is optional */ }
  return governance ? governance.timedRun("autopilot", runOnce, require("../form-governance/summaries").summarizeAutopilot) : runOnce();
}

// scheduler hook used by server.js: initial delayed run + interval, lock-guarded across instances, opt-out with FORM_AUTOPILOT=false
function startFormPipelineAutopilot(withJobLock) {
  if (String(process.env.FORM_AUTOPILOT || "true").toLowerCase() === "false") return null;
  const intervalMs = Number(process.env.FORM_AUTOPILOT_INTERVAL_MS || 6 * 60 * 60 * 1000);
  const tick = () => withJobLock("form-pipeline-autopilot", intervalMs, run).catch((error) => logger.error("form_autopilot_failed", { error: error.message }));
  const initial = setTimeout(tick, Number(process.env.FORM_AUTOPILOT_INITIAL_DELAY_MS || 45 * 1000));
  initial.unref?.();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = { run, syncMissingRegistry, backfillEditionDates, normalizeStoredFileNames, linkComponents, readinessForForm, startFormPipelineAutopilot };
