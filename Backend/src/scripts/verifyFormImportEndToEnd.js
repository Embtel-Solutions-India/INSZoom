// node src/scripts/verifyFormImportEndToEnd.js I-912 [--keep]
// Live proof that a form never imported before goes through the whole code-only pipeline: fetch from uscis.gov -> qpdf normalize (decrypt / XFA) -> import ->
// edition match -> rule inference -> mapping -> component slicing -> certification -> promotion. Prints each stage. Refuses to run for a form that already has a
// template (it would not prove a FIRST import) and, unless --keep, removes ONLY the records this run created (template, mapping versions, component definitions).
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");

const code = (process.argv[2] || "").toUpperCase();
const keep = process.argv.includes("--keep");
const cleanupOnly = process.argv.includes("--cleanup");
const results = [];
const check = (name, ok, detail = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " - " + detail : ""}`); };

async function main() {
  if (!code) throw new Error("usage: verifyFormImportEndToEnd.js <FORM-CODE>");
  await mongoose.connect(env.mongoUri);
  const USCISFormTemplate = require("../models/USCISFormTemplate");
  const USCISMappingVersion = require("../models/USCISMappingVersion");
  const USCISFormComponentDefinition = require("../models/USCISFormComponentDefinition");
  const User = require("../models/User");
  const existing = await USCISFormTemplate.countDocuments({ formCode: code });
  if (existing && !cleanupOnly) throw new Error(`${code} already has ${existing} template(s) - pick a form that was never imported`);
  const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
  const req = { ip: "e2e-import", headers: {}, user: admin };
  const Acquisition = require("../modules/uscis-form-import/services/OnDemandFormAcquisitionService");
  let templateIds = [];
  try {
    if (cleanupOnly) return;
    const started = Date.now();
    const result = await Acquisition.ensureCurrentUSCISForm(code, admin, req);
    const template = result.template;
    templateIds = (await USCISFormTemplate.find({ formCode: code }).select("_id").lean()).map((item) => item._id);
    check("fetched from uscis.gov, normalized and imported", Boolean(template?._id), `${code} ${template?.version} in ${Math.round((Date.now() - started) / 1000)}s`);
    check("PDF stored and fields scanned", Boolean(template.artifacts?.form?.storageKey || template.pdfStorageKey) && (template.formFields || []).length > 0, `${(template.formFields || []).length} fields`);
    const edges = result.biographicMapping ? null : null; // (mapping is read back from the graph below)
    const MappingGraphService = require("../modules/form-mapping/services/MappingGraphService");
    const graph = await MappingGraphService.loadCurrentGraph(template).catch(() => ({ edges: [] }));
    check("mapping built by code (inferred / carried-over rules)", (graph.edges || []).length > 0 || result.biographicReady, `${(graph.edges || []).length} edges, mappingStatus=${template.mappingStatus}`);
    const cert = result.certification || template.importMetadata?.validationSummary?.certification;
    check("certification ran automatically", Boolean(cert), cert ? cert.checks.map((item) => `${item.name}:${item.passed ? "ok" : "FAIL(" + item.detail + ")"}`).join(" ") : "");
    check("certified form is promoted (live), otherwise it stays in review and nothing else is touched", cert?.passed ? template.status === "active" : template.status !== "active", `status=${template.status}`);
    void edges;
  } finally {
    // always look the records up by form code (a crash before the id was recorded must not leave a live test form behind)
    templateIds = (await USCISFormTemplate.find({ formCode: code }).select("_id").lean()).map((item) => item._id);
    if ((!keep || cleanupOnly) && templateIds.length) {
      const a = await USCISMappingVersion.deleteMany({ template: { $in: templateIds } });
      const b = await USCISFormComponentDefinition.deleteMany({ parentTemplateId: { $in: templateIds } });
      const c = await USCISFormTemplate.deleteMany({ _id: { $in: templateIds }, formCode: code });
      console.log(`cleanup: ${c.deletedCount} template(s), ${a.deletedCount} mapping version(s), ${b.deletedCount} component definition(s)`);
    }
    await mongoose.disconnect();
  }
  if (cleanupOnly) process.exit(0);
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });
