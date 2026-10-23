// Phase 7.8: the edition SIMULATION harness. It drives the REAL production code (field scanner, mapping carry-forward + partial activation, certification, release gate, case migration,
// renderer, resolution engine, runner, alerter) over a synthetic old -> new edition pair, on a THROWAWAY local database. Only the outside world is replaced:
//   - uscis.gov            -> a fake `fetch` handed to the real hardened fetcher (test-utils/editionSim/fakeUscis.js)
//   - template PDF storage -> the real storage service on the LOCAL provider in a temp folder (removed when the harness disconnects); no S3 is touched
//   - autofill             -> the same "realistic autofill" the 7.7 tests use (status / version side effects of the real one); the data path of autofill is covered by the mapping tests
//   - e-mail               -> a mocked provider (nothing is sent)
//   - the edition-acceptance record and the activation protocol are NOT re-run here (form-release / form-edition-policy tests own them): the gate is asked with acceptance supplied and
//     "release" is the status flip the protocol ends with.
// Environment is fixed BEFORE anything else is required, so nothing can reach the shared database, S3 or a real mailbox.
const os = require("os");
const path = require("path");
const fs = require("fs");

process.env.STORAGE_PROVIDER = "local";
process.env.LOCAL_STORAGE_PATH = process.env.LOCAL_STORAGE_PATH_SIM || fs.mkdtempSync(path.join(os.tmpdir(), "edition-sim-"));
process.env.EMAIL_SUPPRESS_ALL = "false"; // the mocked provider below is the only sender
process.env.NOTIFICATIONS_SUPPRESS_ALL = "false";
process.env.FORM_EDITION_AUTO_EVIDENCE = "false"; // never a request to uscis.gov for an acceptance check

const crypto = require("crypto");
const mongoose = require("mongoose");
const { pathToFileURL } = require("url");
const pipelineDb = require("../../../../test-utils/pipelineDb");
const { buildBaseEdition, MAPPED_TO, ANSWERS } = require("../../../../test-utils/editionSim/basePdf");

const USCISFormTemplate = require("../../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../../models/USCISMappingVersion");
const CaseForm = require("../../../../models/CaseForm");
const CaseFormMigrationSnapshot = require("../../../../models/CaseFormMigrationSnapshot");
const AuditLog = require("../../../../models/AuditLog");
const FormPipelineJob = require("../../../../models/FormPipelineJob");
const FormPipelineDigest = require("../../../../models/FormPipelineDigest");

const PDFFieldScannerService = require("../../../uscis-form-import/services/PDFFieldScannerService");
const MappingGraphService = require("../../../form-mapping/services/MappingGraphService");
const FormMappingService = require("../../../form-mapping/services/FormMappingService");
const MappingResolver = require("../../../form-mapping/services/MappingResolver");
const { migrateMappingToEdition } = require("../../../form-mapping/services/EditionMigrationService");
const { certify } = require("../../../form-mapping/services/FormCertificationService");
const Migration = require("../../../form-mapping/services/CaseFormEditionMigrationService");
const Recovery = require("../../../form-mapping/services/CaseFormMigrationRecovery");
const ReleaseGate = require("../../../form-release/ReleaseGate");
const PDFRenderer = require("../../../form-generation/services/PDFRenderer");
const storageService = require("../../../uploads/storage.service");
const autonomy = require("../../../../config/formPipelineAutonomy");
const { PDFDocument } = require("pdf-lib");

const MODELS = [USCISFormTemplate, USCISMappingVersion, CaseForm, CaseFormMigrationSnapshot, AuditLog, FormPipelineJob, FormPipelineDigest];
const actor = { _id: new mongoose.Types.ObjectId(), role: "admin", email: "sim-admin@example.test" };
const req = { ip: "127.0.0.1", headers: {} };
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ----- environment ------------------------------------------------------------------------------------------------------------------------------------------------------------
async function connect() {
  const result = await pipelineDb.connectPipelineTestDB();
  if (!result.ok) return result;
  await pipelineDb.ensureIndexes(MODELS);
  return result;
}
async function disconnect() {
  await pipelineDb.disconnectPipelineTestDB();
  if (!process.env.LOCAL_STORAGE_PATH_SIM) fs.rmSync(process.env.LOCAL_STORAGE_PATH, { recursive: true, force: true }); // the temp folder this harness created
}
function withMode(mode, fn) {
  const previous = process.env.FORM_PIPELINE_AUTONOMY;
  process.env.FORM_PIPELINE_AUTONOMY = mode;
  const restore = () => { if (previous === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = previous; };
  return Promise.resolve().then(fn).finally(restore);
}

let adapterPromise = null;
const adapter = () => (adapterPromise ||= import(pathToFileURL(path.resolve(__dirname, "../../../../../../Admin/frontend/src/utils/PDFFieldChangeAdapter.js")).href));

// ----- helpers ----------------------------------------------------------------------------------------------------------------------------------------------------------------
const pdfNameOf = (field) => field.pdfFieldName || field.fieldName;
const idByPdfName = (scan) => Object.fromEntries(scan.fields.map((field) => [pdfNameOf(field), field.fieldId]));
const fresh = (id) => CaseForm.findById(id).lean();
const nonBlank = (value) => value !== undefined && value !== null && value !== "" && value !== false;

async function createTemplate({ formCode, scan, version, status, parent = null, recorder, pdf }) {
  // the PDF goes through the REAL storage service (local provider, a temp folder): every code path that reads a template PDF reads it the way production does
  const storageKey = `government/uscis/${formCode}/${version}/sim-${crypto.randomBytes(4).toString("hex")}/form.pdf`;
  await storageService.storeBuffer(storageKey, pdf);
  const doc = await recorder.create(USCISFormTemplate, {
    pdfStorageKey: storageKey, artifacts: { form: { storageKey, storagePath: storageKey } },
    formCode, title: "Simulation form", version, editionDate: new Date(`${version}T00:00:00Z`), status, mappingStatus: "unmapped", approvedAt: status === "active" ? new Date() : undefined, approvedBy: status === "active" ? actor._id : undefined,
    formFields: scan.fields, ...(parent ? { parentVersion: parent._id } : {}),
  });
  return doc;
}

async function activateOldMapping(template, ids) {
  const exactMappings = {};
  for (const [pdfName, canonical] of Object.entries(MAPPED_TO)) if (ids[pdfName]) exactMappings[ids[pdfName]] = canonical;
  const graph = MappingGraphService.generateGraph(template, {}, { exactMappings, threshold: 0.999 });
  // the live forms hold reviewed (authored) active edges; the scorer would store its own suggestions as needs_review (Rule A), so the synthetic old edition is stamped like a reviewed one
  graph.edges.forEach((edge) => { edge.origin = "authored"; edge.status = "active"; });
  graph.validation = MappingGraphService.validateGraph(graph, template);
  const version = await MappingGraphService.persistVersion(template, graph, actor);
  await USCISMappingVersion.updateOne({ _id: version._id }, { $set: { status: "active", activatedAt: new Date() } });
  template.mappingStatus = "active";
  template.activeMappingVersionId = version._id;
  template.activeMappingVersion = version.mappingVersion;
  await template.save();
  return version;
}

function caseFormDocument({ template, ids, recorder, status = "in_review", answers = ANSWERS }) {
  const filledData = {};
  const fieldValues = {};
  const manualOverrides = {};
  const fieldValueProvenance = {};
  const fieldReviews = {};
  for (const [pdfName, value] of Object.entries(answers)) {
    const id = ids[pdfName];
    if (!id) continue;
    MappingResolver.setPath(filledData, id, value);
    fieldValues[id] = value;
    manualOverrides[id] = { value, reason: "Native PDF field edit", overriddenBy: String(actor._id), overriddenAt: new Date() };
    fieldValueProvenance[Recovery.encodeKey(id)] = { source: "case_manager_override", revision: 1 };
    if (/FamilyName|GivenName/.test(pdfName)) fieldReviews[id] = { status: "approved" };
  }
  return recorder.create(CaseForm, {
    caseId: new mongoose.Types.ObjectId(), formTemplateId: template._id, formCode: template.formCode, formVersion: template.version, status, versionNumber: 3, versions: [{ versionNumber: 2 }],
    reviewState: { status: "in_progress", mode: "case_manager" }, filledData, fieldValues, manualOverrides, fieldValueProvenance, fieldReviews, isLocked: status === "locked",
  });
}

// the 7.7 tests' realistic autofill: moves a migrated form to ai_filled, bumps versionNumber, pushes a version; the migration must put the person's position back
const realisticAutofill = async (caseId, formCode, user, requestInfo, options = {}) => {
  if (!options.caseFormId) throw new Error("autofill was called without the case form id");
  await CaseForm.collection.updateOne({ _id: new mongoose.Types.ObjectId(options.caseFormId) }, { $set: { status: "ai_filled", versionNumber: 99, updatedAt: new Date() }, $push: { versions: { versionNumber: 98 } } });
};
const migrationDeps = (mode, extra = {}) => ({ mode: () => mode, requireAcceptedEdition: async () => {}, autofill: realisticAutofill, oldEditionNotAccepted: async () => false, ...extra });

async function readBack(buffer, names) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  const form = pdf.getForm();
  const out = {};
  for (const name of names) {
    let field = null;
    try { field = form.getField(name); } catch { field = null; }
    if (!field) { out[name] = { present: false }; continue; }
    const kind = field.constructor.name;
    let value = null;
    if (kind === "PDFCheckBox") value = field.isChecked();
    else if (kind === "PDFRadioGroup") value = field.getSelected() || null;
    else if (kind === "PDFDropdown") value = (field.getSelected() || [])[0] || null;
    else if (typeof field.getText === "function") value = field.getText() || "";
    out[name] = { present: true, kind, value };
  }
  return out;
}

// ----- the edition scenario ---------------------------------------------------------------------------------------------------------------------------------------------------
/**
 * Runs one old -> new edition scenario in `mode` (off | shadow | on). Resolves a metrics object:
 *   { id, mode, endState, autonomous, loss, corruption, steps{}, defects[], notes[], pdf{} , durationMs }
 * endState: "released" (the gate promoted it, the cases moved) | "held:<first failing check>" | "error:<step>".
 */
async function runEditionScenario(scenario, { mode = "on", recorder, logger = silent, migrationFault = null } = {}) {
  const started = Date.now();
  const metrics = { id: migrationFault ? `${scenario.id}+db_error_at_${migrationFault}` : scenario.id, label: scenario.label, synthetic: Boolean(scenario.synthetic), mode, endState: "error:setup", autonomous: false, loss: 0, corruption: 0, steps: {}, defects: [], notes: [], pdf: {}, durationMs: 0 };
  const step = async (name, fn) => {
    try { const value = await fn(); metrics.steps[name] = "ok"; return value; }
    catch (error) { metrics.steps[name] = `failed: ${String(error.message).slice(0, 160)}`; metrics.defects.push({ step: name, error: String(error.stack || error.message).split("\n").slice(0, 3).join(" | ") }); throw Object.assign(error, { simStep: name }); }
  };
  try {
    await withMode(mode, async () => {
      const formCode = pipelineDb.uniqueFormCode("ZZ-SIM");
      const oldPdf = await buildBaseEdition();
      const newPdf = await scenario.mutate(oldPdf);
      const scanner = new PDFFieldScannerService();
      const oldScan = await step("scan_old", () => scanner.scan(oldPdf));
      const newScan = await step("scan_new", () => scanner.scan(newPdf));
      const oldIds = idByPdfName(oldScan);
      const newIds = idByPdfName(newScan);

      const oldTemplate = await createTemplate({ formCode, scan: oldScan, version: "2025-01-01", status: "active", recorder, pdf: oldPdf });
      await step("old_mapping", () => activateOldMapping(oldTemplate, oldIds));
      const newTemplate = await createTemplate({ formCode, scan: newScan, version: "2026-01-01", status: "review", parent: oldTemplate, recorder, pdf: newPdf });

      const typed = await caseFormDocument({ template: oldTemplate, ids: oldIds, recorder });
      const frozen = await caseFormDocument({ template: oldTemplate, ids: oldIds, recorder, status: "filed" });
      const frozenBefore = JSON.stringify(await fresh(frozen._id));

      // detect -> map: the real carry-forward; in "on" an unmappable box is left blank and the rest is activated
      const mapping = await step("map", () => migrateMappingToEdition(newTemplate, actor, req, { previousTemplate: oldTemplate }));
      metrics.mapping = { activated: Boolean(mapping.activated), partial: Boolean(mapping.partial), reason: mapping.reason || null, leftUnmapped: mapping.leftUnmapped || null, summary: mapping.summary || null, message: mapping.message || null };

      metrics.newFieldIds = ((await USCISFormTemplate.findById(newTemplate._id).lean()).formFields || []).map((field) => `${field.fieldId}=${field.pdfFieldName}`);
      // certify (real checks, real PDF bytes)
      const certified = await step("certify", async () => certify(await USCISFormTemplate.findById(newTemplate._id), { previous: oldTemplate }));
      metrics.certification = { passed: Boolean(certified.passed), failed: (certified.checks || []).filter((c) => !c.passed).map((c) => `${c.name}: ${String(c.detail || "").slice(0, 100)}`) };

      // release: the real gate, acceptance supplied
      const releasing = await USCISFormTemplate.findById(newTemplate._id);
      releasing.approvedAt = new Date();
      releasing.approvedBy = actor._id;
      await releasing.save();
      const gate = await step("release_gate", () => ReleaseGate.evaluate(releasing, { req, deps: { policy: async () => ({ allowed: true }) } }));
      metrics.gate = { decision: gate.decision, failing: gate.checks.filter((c) => !["pass", "degraded"].includes(c.outcome)).map((c) => `${c.name}: ${c.detail}`.slice(0, 160)) };
      if (!gate.canPromote) {
        metrics.endState = `held:${(metrics.gate.failing[0] || gate.decision).slice(0, 80)}`;
        const stillOld = await fresh(typed._id);
        if (JSON.stringify(stillOld.fieldValues) !== JSON.stringify((await fresh(typed._id)).fieldValues)) metrics.defects.push({ step: "held", error: "case form changed while the edition was held" });
        return;
      }
      await USCISFormTemplate.updateOne({ _id: oldTemplate._id }, { $set: { status: "retired", activeFlag: false } });
      await USCISFormTemplate.updateOne({ _id: newTemplate._id }, { $set: { status: "active", activeFlag: true } });
      const released = await USCISFormTemplate.findById(newTemplate._id);

      // case migration (real service); then the answers are checked against the scenario's expectation
      // a database error in the middle of the migration (injected at a checkpoint of the real service): the next run (the sweeper, then the migration again) must finish it
      if (migrationFault) {
        let fired = false;
        const faulty = migrationDeps(mode, { checkpoint: async (point) => { if (!fired && point === migrationFault) { fired = true; throw new Error(`injected database error at ${point}`); } } });
        const first = await step("case_migration_faulted", () => Migration.migrateCaseFormsToEdition({ newTemplate: released, actor, req, deps: faulty }));
        const stoppedAt = (await fresh(typed._id)).migrationState?.step || null;
        const reconciled = await step("case_migration_reconcile", () => Recovery.reconcileIncompleteMigrations({ deps: migrationDeps(mode), actor, req }));
        metrics.fault = { at: migrationFault, injected: fired, firstRunFailed: first.failed?.length || 0, stoppedAt, reconciled: { examined: reconciled.examined, resumed: reconciled.resumed.length, released: reconciled.released.length, failed: reconciled.failed.length } };
        if (!fired) metrics.defects.push({ step: "fault", error: `the checkpoint "${migrationFault}" was never reached` });
      }
      const result = await step("case_migration", () => Migration.migrateCaseFormsToEdition({ newTemplate: released, actor, req, deps: migrationDeps(mode) }));
      metrics.migration = { considered: result.considered, migrated: result.migrated, verified: result.verified, skippedFrozen: result.skippedFrozen, failed: result.failed?.length || 0, parked: result.parked?.length || 0, unresolved: result.unresolved?.length || 0, valuesArchived: result.valuesArchived || 0, unresolvedSample: (result.unresolved || []).slice(0, 8).map((u) => `${u.bag || ""} ${(u.oldKeys || []).join(",")}: ${u.code || ""}`.slice(0, 200)), parkedSample: (result.parked || []).slice(0, 2).map((p) => JSON.stringify(p).slice(0, 300)) };
      const after = await fresh(typed._id);
      const archivedText = JSON.stringify(after.editionMigrations || []);
      const wholeDoc = JSON.stringify(after);
      const keptAnywhere = (value) => wholeDoc.includes(JSON.stringify(String(value)).slice(1, -1)); // the answer is somewhere on the case form (its box, its old key, or the archive)
      const notMoved = (metrics.migration.parked || 0) + (metrics.migration.unresolved || 0) + (metrics.migration.failed || 0) > 0;
      metrics.notMigrated = notMoved;
      const expectedNew = {};
      for (const [pdfName, value] of Object.entries(ANSWERS)) {
        if (!nonBlank(value)) continue;
        const destName = Object.prototype.hasOwnProperty.call(scenario.dest, pdfName) ? scenario.dest[pdfName] : pdfName;
        const archivedOk = archivedText.includes(String(value).slice(0, 40));
        const either = (scenario.either || []).includes(pdfName);
        if (destName === null) { if (!keptAnywhere(value)) metrics.loss += 1; continue; }
        const id = newIds[destName];
        if (!id) { if (!keptAnywhere(value)) metrics.loss += 1; continue; }
        expectedNew[id] = value;
        const got = after.fieldValues?.[id];
        if (got === value) continue;
        if (either && (archivedOk || nonBlank(got))) continue;
        if (notMoved) { if (!keptAnywhere(value)) metrics.loss += 1; continue; } // a parked case form keeps every answer under its old key on its old edition
        if (nonBlank(got)) metrics.corruption += 1; // a different value sits in the box
        else if (!keptAnywhere(value)) metrics.loss += 1; // the answer is neither in its box nor archived nor anywhere on the form
        else metrics.notes.push(`${pdfName}: archived with a reason instead of carried`);
      }
      for (const [id, value] of Object.entries(notMoved ? {} : (after.fieldValues || {}))) {
        if (!nonBlank(value) || !Object.values(newIds).includes(id)) continue;
        if (id in expectedNew) continue;
        if ((scenario.either || []).some((name) => newIds[name] === id)) continue;
        metrics.corruption += 1; // a value in a box nobody expected to receive one
      }
      for (const name of scenario.blank || []) {
        const id = newIds[name];
        if (id && nonBlank(after.fieldValues?.[id])) metrics.corruption += 1;
      }
      if (!notMoved && String(after.formTemplateId) !== String(released._id)) metrics.defects.push({ step: "migration", error: "the case form is not on the new edition after the migration" });
      if (after.migrationState && Recovery.IN_PROGRESS_STEPS.includes(after.migrationState.step)) metrics.defects.push({ step: "migration", error: `the case form is stuck mid-migration (${after.migrationState.step})` });
      const frozenAfter = JSON.stringify(await fresh(frozen._id));
      if (frozenAfter !== frozenBefore) metrics.defects.push({ step: "frozen", error: "a frozen (filed) case form was changed by the migration" });
      if (after.status !== "in_review") metrics.defects.push({ step: "status", error: `workflow status changed to ${after.status}` });

      // download: the real renderer on the migrated form, read back from the PDF
      // a case form that was PARKED stays on the old edition (which must keep opening and downloading with every answer); a migrated one is shown on the new edition
      const viewTemplate = notMoved ? await USCISFormTemplate.findById(oldTemplate._id) : released;
      const viewMapping = await USCISMappingVersion.findOne({ template: viewTemplate._id, status: "active" }).lean();
      const renderTemplate = FormMappingService.applyMappingGraph(JSON.parse(JSON.stringify(viewTemplate.toObject())), viewMapping || {});
      renderTemplate._id = viewTemplate._id;
      const dest = (name) => (notMoved ? name : (Object.prototype.hasOwnProperty.call(scenario.dest, name) ? scenario.dest[name] : name));
      const idsView = notMoved ? oldIds : newIds;
      metrics.pdfViewedOn = notMoved ? "old edition (case form parked)" : "new edition";
      const names = Object.keys(ANSWERS).map((name) => dest(name)).filter(Boolean);
      const rendered = await step("download", () => PDFRenderer.render({ caseForm: after, template: renderTemplate, watermark: null, flatten: false }));
      const first = await readBack(rendered.buffer, names);
      const check = (label, ok, note) => { metrics.pdf[label] = ok ? "ok" : `FAIL${note ? `: ${note}` : ""}`; if (!ok && !(notMoved ? [] : (scenario.pdfNotes || [])).some((n) => n.startsWith(dest(label) || label))) metrics.defects.push({ step: "download", error: `${label} ${note || "not in the downloaded PDF"}` }); };
      const text = (name) => first[dest(name)];
      if (dest("Pt1_CountryOfBirth")) check("long_text_country", text("Pt1_CountryOfBirth")?.value === ANSWERS.Pt1_CountryOfBirth, `length ${String(text("Pt1_CountryOfBirth")?.value || "").length} of ${ANSWERS.Pt1_CountryOfBirth.length}`);
      if (dest("Pt1_Notes")) check("long_text_notes", text("Pt1_Notes")?.value === ANSWERS.Pt1_Notes, `length ${String(text("Pt1_Notes")?.value || "").length} of ${ANSWERS.Pt1_Notes.length}`);
      if (dest("Pt1_ReadOnly")) check("read_only_box", text("Pt1_ReadOnly")?.value === ANSWERS.Pt1_ReadOnly);
      if (dest("Pt1_FamilyName")) check("mapped_box", text("Pt1_FamilyName")?.value === ANSWERS.Pt1_FamilyName);
      if (dest("Pt2_Married_Yes") && (notMoved || !(scenario.either || []).includes("Pt2_Married_Yes"))) check("tick", text("Pt2_Married_Yes")?.value === true);
      if (dest("Pt2_Visa")) check("dropdown", text("Pt2_Visa")?.value === "H1B");
      if (dest("Pt2_Status") && (notMoved || !(scenario.pdfNotes || []).length)) check("radio", text("Pt2_Status")?.value === "Married");
      for (const note of notMoved ? [] : (scenario.pdfNotes || [])) metrics.notes.push(note);
      for (const name of notMoved ? [] : (scenario.blank || [])) metrics.pdf[`blank_${name}`] = first[name]?.value ? "FAIL: a box with no source was filled" : "ok";

      // edit + save: a person ticks the other box and edits two boxes (the real Admin adapter builds the saved value; the write follows the storage contract of overrideFieldById)
      const { convert } = await adapter();
      const editedAs = {};
      const edits = { Pt2_Married_No: "tick", Pt1_Notes: `EDITED-NOTES-${"e".repeat(400)}`, Pt1_ReadOnly: `EDITED-READ-ONLY-${"r".repeat(100)}` };
      const current = await fresh(typed._id);
      const patchValues = { ...(current.fieldValues || {}) };
      const patchOverrides = { ...(current.manualOverrides || {}) };
      const patchData = JSON.parse(JSON.stringify(current.filledData || {}));
      for (const [pdfName, wanted] of Object.entries(edits)) {
        const id = idsView[dest(pdfName)];
        if (!id) continue;
        const meta = { fieldMetaByName: { [id]: {} } };
        let value = wanted;
        if (wanted === "tick") {
          const dom = convert({ target: { name: id, type: "checkbox", checked: true, value: "on" } }, "x", {}, meta).value;
          value = convert({ fieldName: id, fieldType: "checkbox", value: dom }, "x", {}, meta).value;
        } else value = convert({ fieldName: id, fieldType: "text", value: wanted }, "x", {}, meta).value;
        editedAs[pdfName] = value;
        patchValues[id] = value; // flat dotted keys, exactly how the case form stores them
        MappingResolver.setPath(patchData, id, value);
        patchOverrides[id] = { value, reason: "Native PDF field edit", overriddenBy: String(actor._id), overriddenAt: new Date() };
      }
      await CaseForm.collection.updateOne({ _id: typed._id }, { $set: { fieldValues: patchValues, manualOverrides: patchOverrides, filledData: patchData } });
      const edited = await fresh(typed._id);
      const secondPdf = await step("download_after_edit", () => PDFRenderer.render({ caseForm: edited, template: renderTemplate, watermark: null, flatten: false }));
      const second = await readBack(secondPdf.buffer, Object.keys(editedAs).map(dest).filter(Boolean));
      if (editedAs.Pt2_Married_No !== undefined) check("tick_saved_and_downloaded", second[dest("Pt2_Married_No")]?.value === true && editedAs.Pt2_Married_No === "Yes");
      if (editedAs.Pt1_Notes !== undefined) check("edit_long_text", second[dest("Pt1_Notes")]?.value === editedAs.Pt1_Notes);
      if (editedAs.Pt1_ReadOnly !== undefined) check("edit_read_only_box", second[dest("Pt1_ReadOnly")]?.value === editedAs.Pt1_ReadOnly);

      // a second run changes nothing
      const imageBefore = Recovery.imageChecksum(Recovery.imageOf(await fresh(typed._id)));
      await Migration.migrateCaseFormsToEdition({ newTemplate: released, actor, req, deps: migrationDeps(mode) });
      const imageAfter = Recovery.imageChecksum(Recovery.imageOf(await fresh(typed._id)));
      metrics.idempotent = imageBefore === imageAfter;
      if (!metrics.idempotent) metrics.defects.push({ step: "idempotent", error: "a second migration run changed the case form" });

      metrics.endState = "released";
    });
  } catch (error) {
    metrics.endState = `error:${error.simStep || "run"}`;
    if (!metrics.defects.length) metrics.defects.push({ step: error.simStep || "run", error: String(error.stack || error.message).split("\n").slice(0, 3).join(" | ") });
  } finally {
    metrics.durationMs = Date.now() - started;
  }
  const clean = !metrics.defects.length && metrics.loss === 0 && metrics.corruption === 0 && !Object.values(metrics.pdf).some((v) => String(v).startsWith("FAIL"));
  metrics.autonomous = metrics.endState === "released" && clean && !metrics.notMigrated;
  if (metrics.endState === "released" && metrics.notMigrated) metrics.endState = "released_cases_parked";
  metrics.clean = clean;
  // autonomous = released with every answer where it belongs and no human step; held = the gate / mapping stopped it (the live edition untouched); parked = released, but some case forms wait on the old edition
  metrics.outcome = metrics.autonomous ? "autonomous" : String(metrics.endState).startsWith("held") ? "held" : metrics.endState === "released_cases_parked" ? "parked" : "error";
  metrics.matchesExpectation = mode !== "on" || !scenario.expectOutcome ? null : metrics.outcome === scenario.expectOutcome && clean;
  return metrics;
}

module.exports = { connect, disconnect, withMode, runEditionScenario, createRecorder: pipelineDb.createRecorder, actor, req, silent, sleep, MODELS, MAPPED_TO, ANSWERS, buildBaseEdition, readBack, adapter, FormPipelineJob, USCISFormTemplate, autonomy };
