#!/usr/bin/env node
// Fresh start of ONE USCIS form: backs everything up, removes the form's templates, mapping versions and stored PDFs (and the case forms you name), then fetches the
// current edition from uscis.gov again and rebuilds its mapping by code.
//
//   node src/scripts/freshStartForm.js I-131 --delete-case-form <id>            # DRY RUN (default): lists exactly what would be backed up and deleted, writes nothing
//   node src/scripts/freshStartForm.js I-131 --delete-case-form <id> --apply    # does it
//
// Deleted:   the form's USCISFormTemplate documents, their USCISMappingVersion and USCISFormComponentDefinition documents, every object under government/uscis/<code>/ in the
//            file storage, and the CaseForm(s) + their CaseFormSelection rows that you name with --delete-case-form (any other case form that uses the form stops the run).
// Kept:      the visa -> form registry rows (VisaFormMapping: which visa types get the form and which checklists feed it), the form-edition decisions / evidence (append-only),
//            the pipeline job history, and all source code (crosswalks, rules).
// Safety:    nothing is deleted until uscis.gov has answered with a valid official PDF and the backup (JSON of every document + a copy of every stored file) is on disk;
//            a form being imported right now stops the run; the dry run changes nothing.
// Rebuild:   import the official PDF (the importer's own checks) -> the form's authored crosswalk graph (form-mapping/seeds) -> the checklist -> generic party path rewire ->
//            the form's party rules (+ copies of unlocked boxes) -> visa scope -> certification -> approval and activation through the edition-acceptance gate.
const fs = require("fs");
const path = require("path");

// forms whose authored crosswalk seed builds the first mapping graph of a fresh import (the pipeline itself only has one for G-28)
const SEEDS = { "I-131": "../modules/form-mapping/seeds/i131-perm-mapping.seed" };

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");
const idsOf = (list) => list.map((item) => item._id);

async function main(argv = process.argv.slice(2)) {
  const apply = argv.includes("--apply");
  const formCode = String(argv.find((arg) => !arg.startsWith("--") && !/^[0-9a-f]{24}$/i.test(arg)) || "").toUpperCase();
  const caseFormIds = argv.flatMap((arg, index) => (arg === "--delete-case-form" ? [argv[index + 1]] : [])).filter(Boolean);
  if (!formCode) { console.error("usage: freshStartForm.js <form code> [--delete-case-form <id> ...] [--apply]"); return 2; }

  require("dotenv").config();
  const mongoose = require("mongoose");
  const env = require("../config/env");
  await mongoose.connect(env.mongoUri || process.env.MONGODB_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    const USCISFormTemplate = require("../models/USCISFormTemplate");
    const USCISMappingVersion = require("../models/USCISMappingVersion");
    const USCISFormComponentDefinition = require("../models/USCISFormComponentDefinition");
    const CaseForm = require("../models/CaseForm");
    const CaseFormSelection = require("../models/CaseFormSelection");
    const FormPipelineJob = require("../models/FormPipelineJob");
    const User = require("../models/User");
    const storage = require("../modules/uploads/storage.service");

    const templates = await USCISFormTemplate.find({ formCode }).lean();
    if (!templates.length) { console.log(`${formCode}: no template on file - nothing to delete`); }
    const templateIds = idsOf(templates);
    const versions = await USCISMappingVersion.find({ template: { $in: templateIds } }).lean();
    const components = await USCISFormComponentDefinition.find({ parentTemplateId: { $in: templateIds } }).lean();
    const caseForms = await CaseForm.find({ formTemplateId: { $in: templateIds } }).lean();
    const named = new Set(caseFormIds);
    const unnamed = caseForms.filter((item) => !named.has(String(item._id)));
    const selections = await CaseFormSelection.find({ formCode, $or: [{ caseFormId: { $in: caseForms.filter((item) => named.has(String(item._id))).map((item) => item._id) } }, { templateId: { $in: templateIds } }] }).lean();
    const keys = [];
    for await (const key of storage.rawObjects.listKeys(`government/uscis/${formCode}/`)) keys.push(key);
    const running = await FormPipelineJob.exists({ formCode, state: "running" });

    console.log(`${formCode}: ${templates.length} template(s) [${templates.map((item) => `${item.version} ${item.status}`).join(", ")}], ${versions.length} mapping version(s), ${components.length} component definition(s), ${keys.length} stored file(s)`);
    console.log(`case forms using it: ${caseForms.length}; named for deletion: ${caseForms.length - unnamed.length}; their selection rows: ${selections.length}`);
    caseForms.filter((item) => named.has(String(item._id))).forEach((item) => console.log(`  - case form ${item._id} on case ${item.caseId} (status ${item.status}, v${item.versionNumber}) WILL BE DELETED`));
    if (unnamed.length) { console.log(`REFUSED: ${unnamed.length} other case form(s) use this form and were not named with --delete-case-form: ${unnamed.map((item) => item._id).join(", ")}`); return 1; }
    if (running) { console.log(`REFUSED: ${formCode} is being imported right now; try again when that has finished`); return 1; }
    console.log(`kept: visa -> form registry rows, edition decisions, pipeline job history, source code`);
    if (!apply) { console.log("\nDRY RUN: nothing was backed up, deleted or imported. Re-run with --apply."); return 0; }

    // ---- 1. proof that the form can be fetched again (before anything is deleted) ----
    const { resolveOfficialPdf } = require("../modules/uscis-form-import/services/OnDemandFormAcquisitionService");
    const importer = require("../modules/uscis-form-import/services/USCISFormImporterService");
    const resolved = await resolveOfficialPdf(formCode);
    let probe = null;
    let probeError = "";
    try { probe = await importer.downloadOfficialPdf(resolved.pdfUrl, "form"); } catch (error) { probeError = error.message; }
    if (!probe?.buffer?.length || probe.buffer.slice(0, 5).toString() !== "%PDF-") { console.log(`REFUSED: uscis.gov did not return a valid PDF for ${formCode} (${probeError || "not a PDF"}); nothing was deleted`); return 1; }
    console.log(`uscis.gov answered: ${resolved.pdfUrl} (${probe.buffer.length} bytes, edition ${resolved.editionDate || "unknown"})`);

    // ---- 2. backup ----
    const dir = path.resolve(__dirname, "../../backups/forms", `${formCode}-fresh-start-${stamp()}`);
    fs.mkdirSync(path.join(dir, "files"), { recursive: true });
    const write = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
    write("templates.json", templates);
    write("mappingVersions.json", versions);
    write("componentDefinitions.json", components);
    write("caseForms.json", caseForms.filter((item) => named.has(String(item._id))));
    write("caseFormSelections.json", selections);
    for (const key of keys) {
      const bytes = await storage.readBuffer(key);
      const target = path.join(dir, "files", key.replace(/[\\/:]/g, "__"));
      fs.writeFileSync(target, bytes);
      if (fs.statSync(target).size !== bytes.length || !bytes.length) throw new Error(`backup of ${key} failed; nothing was deleted`);
    }
    console.log(`backup written to ${path.relative(process.cwd(), dir)} (${templates.length} templates, ${versions.length} mapping versions, ${keys.length} files)`);

    // ---- 3. delete ----
    const namedForms = caseForms.filter((item) => named.has(String(item._id)));
    const deleted = {};
    deleted.caseForms = (await CaseForm.deleteMany({ _id: { $in: idsOf(namedForms) } })).deletedCount;
    deleted.selections = (await CaseFormSelection.deleteMany({ _id: { $in: idsOf(selections) } })).deletedCount;
    deleted.mappingVersions = (await USCISMappingVersion.deleteMany({ template: { $in: templateIds } })).deletedCount;
    deleted.components = (await USCISFormComponentDefinition.deleteMany({ parentTemplateId: { $in: templateIds } })).deletedCount;
    deleted.templates = (await USCISFormTemplate.deleteMany({ _id: { $in: templateIds } })).deletedCount;
    deleted.files = 0;
    for (const key of keys) if (await storage.deleteObject(key)) deleted.files += 1;
    console.log("deleted:", JSON.stringify(deleted));

    // ---- 4. fetch fresh and rebuild ----
    const actor = (await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 })) || { role: "super_admin" };
    const req = { ip: "script", headers: {} };
    const imported = await importer.importFromUrl({ pdfUrl: resolved.pdfUrl, formType: formCode, source: "fresh_start", officialPageUrl: resolved.officialPageUrl, editionDate: resolved.editionDate }, actor, req);
    let template = await USCISFormTemplate.findById(imported.template._id);
    console.log(`imported ${formCode} ${template.version} [${template.status}], ${(template.formFields || []).length} boxes`);

    if (SEEDS[formCode]) {
      const seeded = await require(SEEDS[formCode])({ user: actor, template });
      console.log("crosswalk graph:", JSON.stringify({ mappingVersion: seeded.mappingVersion?.mappingVersion, status: seeded.mappingVersion?.status, edges: seeded.graph?.edges?.length, missingSource: seeded.graph?.missingSourceTargets?.length }));
      template = await USCISFormTemplate.findById(template._id);
    }
    const Rewire = require("../modules/form-mapping/services/ChecklistPartyRewireService");
    const rewired = await Rewire.apply(template, actor, req, { dryRun: false, activate: true });
    console.log("generic party paths:", JSON.stringify({ rewired: rewired.rewired, retargeted: rewired.retargeted, conditionsRewired: rewired.conditionsRewired, saved: rewired.saved, activated: rewired.activated, error: rewired.error }));
    template = await USCISFormTemplate.findById(template._id);
    const PartyFieldMappingService = require("../modules/form-mapping/services/PartyFieldMappingService");
    const rules = await PartyFieldMappingService.apply(template, actor, req, { dryRun: false, allowInference: false });
    console.log("party rules:", JSON.stringify({ created: rules.created, rewired: rules.rewired, mirrored: rules.mirrored, saved: rules.saved, activated: rules.activated, validation: rules.validation, error: rules.error }));
    template = await USCISFormTemplate.findById(template._id);
    try {
      const { deriveVisaTypesFromRegistry } = require("../modules/uscis-form-import/seeds/deriveVisaTypesFromRegistry");
      const merged = Array.from(new Set([...(template.visaTypes || []), ...(await deriveVisaTypesFromRegistry(formCode))]));
      if (merged.length !== (template.visaTypes || []).length) { template.visaTypes = merged; await template.save(); }
      console.log(`visa scope: ${merged.length} visa type(s)`);
    } catch (error) { console.log("visa scope not set:", error.message); }

    const FormCertificationService = require("../modules/form-mapping/services/FormCertificationService");
    const MappingGraphService = require("../modules/form-mapping/services/MappingGraphService");
    const certification = await FormCertificationService.certify(template, { previous: null });
    await FormCertificationService.backupTemplate(template, await MappingGraphService.loadCurrentGraph(template).catch(() => null));
    console.log("certification:", certification.passed ? "PASSED" : "FAILED", JSON.stringify((certification.checks || []).filter((check) => !check.passed)).slice(0, 400));
    if (!certification.passed) { console.log("NOT activated: certification failed. The fresh edition is saved for review; fix the failing check and activate it from Form Governance."); return 1; }

    const VersionManagementService = require("../modules/uscis-lifecycle/services/VersionManagementService");
    if (template.status !== "review") template = await VersionManagementService.approve(template._id, actor, req);
    const activated = await VersionManagementService.activate(template._id, actor, req);
    template = activated?.template || (await USCISFormTemplate.findById(template._id));
    console.log(`activated ${formCode} ${template.version} [${template.status}] mapping v${template.activeMappingVersion}`);
    return 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main().then((code) => process.exit(code), (error) => { console.error("failed:", error.stack || error.message); process.exit(1); });

module.exports = { SEEDS };
