// node src/scripts/verifyFormImportEndToEnd.js I-912 [--dry-run] [--keep]      imports a form that was NEVER imported, proves each stage, then removes what it created
// node src/scripts/verifyFormImportEndToEnd.js I-912 --cleanup [--dry-run]     removes ONLY what an earlier --keep run of this script recorded
//
// Live proof that a form never imported before goes through the whole code-only pipeline: fetch from uscis.gov -> qpdf normalize (decrypt / XFA) -> import ->
// edition match -> rule inference -> mapping -> component slicing -> certification -> promotion. Prints each stage.
//
// Safety (plan Phase 0): the run refuses when the form code already has a template (it would not prove a FIRST import, and everything under that code would be
// ambiguous), records the ids it created in a run file, and both the automatic clean-up and --cleanup delete ONLY the recorded ids - never "everything with this
// code". Either refuses when no id was recorded, when a recorded template is no longer for this form code, or when any case form references a template. --dry-run
// changes nothing: it reports what would be imported / deleted.
const fs = require("fs");
const os = require("os");
const path = require("path");

const runFile = (code) => path.join(os.tmpdir(), `verify-form-import-${String(code).replace(/[^A-Z0-9-]/gi, "_")}.json`);

/**
 * Pure. Decides what clean-up may delete.
 *   recordedIds: ids this script recorded as created; templates: [{ _id, formCode }] currently stored for those ids; referencedIds: ids a case form references.
 * Returns { ok, deleteIds, refusal }.
 */
function planCleanup({ code, recordedIds, templates, referencedIds }) {
  const recorded = (recordedIds || []).map(String);
  if (!recorded.length) return { ok: false, deleteIds: [], refusal: `no template id was recorded for ${code}; nothing is deleted` };
  const found = (templates || []).filter((item) => recorded.includes(String(item._id)));
  const foreign = found.filter((item) => String(item.formCode).toUpperCase() !== String(code).toUpperCase());
  if (foreign.length) return { ok: false, deleteIds: [], refusal: `recorded id(s) ${foreign.map((item) => item._id).join(", ")} belong to another form code; nothing is deleted` };
  const referenced = (referencedIds || []).map(String).filter((id) => recorded.includes(id));
  if (referenced.length) return { ok: false, deleteIds: [], refusal: `${referenced.length} recorded template(s) are referenced by case forms; nothing is deleted` };
  return { ok: true, deleteIds: found.map((item) => item._id), refusal: null };
}

async function main(argv = process.argv.slice(2)) {
  const code = (argv.find((arg) => !arg.startsWith("--")) || "").toUpperCase();
  const keep = argv.includes("--keep");
  const cleanupOnly = argv.includes("--cleanup");
  const dryRun = argv.includes("--dry-run");
  if (!code) throw new Error("usage: verifyFormImportEndToEnd.js <FORM-CODE> [--dry-run] [--keep] | --cleanup [--dry-run]");
  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  const results = [];
  const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " - " + detail : ""}`); };

  await mongoose.connect(env.mongoUri);
  const USCISFormTemplate = require("../models/USCISFormTemplate");
  const USCISMappingVersion = require("../models/USCISMappingVersion");
  const USCISFormComponentDefinition = require("../models/USCISFormComponentDefinition");
  const CaseForm = require("../models/CaseForm");
  const User = require("../models/User");

  async function cleanup(recordedIds) {
    const templates = recordedIds.length ? await USCISFormTemplate.find({ _id: { $in: recordedIds } }).select("_id formCode").lean() : [];
    const referenced = recordedIds.length ? await CaseForm.find({ formTemplateId: { $in: recordedIds } }).distinct("formTemplateId") : [];
    const plan = planCleanup({ code, recordedIds, templates, referencedIds: referenced });
    if (!plan.ok) { console.log(`cleanup refused: ${plan.refusal}`); return false; }
    if (dryRun) { console.log(`dry run: would delete ${plan.deleteIds.length} template(s) (${plan.deleteIds.join(", ")}) with their mapping versions and component definitions`); return true; }
    const a = await USCISMappingVersion.deleteMany({ template: { $in: plan.deleteIds } });
    const b = await USCISFormComponentDefinition.deleteMany({ parentTemplateId: { $in: plan.deleteIds } });
    const c = await USCISFormTemplate.deleteMany({ _id: { $in: plan.deleteIds }, formCode: code });
    console.log(`cleanup: ${c.deletedCount} template(s), ${a.deletedCount} mapping version(s), ${b.deletedCount} component definition(s)`);
    fs.rmSync(runFile(code), { force: true });
    return true;
  }

  try {
    if (cleanupOnly) {
      const recorded = fs.existsSync(runFile(code)) ? JSON.parse(fs.readFileSync(runFile(code), "utf8")).templateIds || [] : [];
      return (await cleanup(recorded)) ? 0 : 1;
    }

    const existing = await USCISFormTemplate.countDocuments({ formCode: code });
    if (existing) throw new Error(`${code} already has ${existing} template(s) - pick a form that was never imported (nothing was changed)`);
    if (dryRun) { console.log(`dry run: ${code} has no template; a real run would import it from uscis.gov, certify it and ${keep ? "keep" : "then remove"} what it created. Nothing was changed.`); return 0; }

    const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
    const req = { ip: "e2e-import", headers: {}, user: admin };
    const Acquisition = require("../modules/uscis-form-import/services/OnDemandFormAcquisitionService");
    let recordedIds = [];
    const record = async () => {
      // the form code had no template when this run started, so every template under it now was created by this run
      recordedIds = (await USCISFormTemplate.find({ formCode: code }).select("_id").lean()).map((item) => String(item._id));
      if (recordedIds.length) fs.writeFileSync(runFile(code), JSON.stringify({ code, templateIds: recordedIds, at: new Date().toISOString() }));
    };
    try {
      const started = Date.now();
      const result = await Acquisition.ensureCurrentUSCISForm(code, admin, req);
      await record();
      const template = result.template;
      check("fetched from uscis.gov, normalized and imported", Boolean(template?._id), `${code} ${template?.version} in ${Math.round((Date.now() - started) / 1000)}s`);
      check("PDF stored and fields scanned", Boolean(template.artifacts?.form?.storageKey || template.pdfStorageKey) && (template.formFields || []).length > 0, `${(template.formFields || []).length} fields`);
      const MappingGraphService = require("../modules/form-mapping/services/MappingGraphService");
      const graph = await MappingGraphService.loadCurrentGraph(template).catch(() => ({ edges: [] }));
      check("mapping built by code (inferred / carried-over rules)", (graph.edges || []).length > 0 || result.biographicReady, `${(graph.edges || []).length} edges, mappingStatus=${template.mappingStatus}`);
      const cert = result.certification || template.importMetadata?.validationSummary?.certification;
      check("certification ran automatically", Boolean(cert), cert ? cert.checks.map((item) => `${item.name}:${item.passed ? "ok" : "FAIL(" + item.detail + ")"}`).join(" ") : "");
      check("certified form is promoted (live), otherwise it stays in review and nothing else is touched", cert?.passed ? template.status === "active" : template.status !== "active", `status=${template.status}`);
    } finally {
      await record().catch(() => null); // a crash before the ids were recorded must not leave a live test form behind
      if (!keep && recordedIds.length) await cleanup(recordedIds);
      else if (recordedIds.length) console.log(`kept ${recordedIds.length} template(s); remove them later with: node src/scripts/verifyFormImportEndToEnd.js ${code} --cleanup`);
    }
    const failed = results.filter((ok) => !ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    return failed ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((exit) => process.exit(exit), (error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });

module.exports = { planCleanup, runFile, main };
