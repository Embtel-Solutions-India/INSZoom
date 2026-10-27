// Automatic production-readiness certification of a USCIS form edition. Runs from code on every import / edition change (OnDemandFormAcquisitionService
// .activateOrPromote) and can be re-run on demand (scripts/certifyForm.js). An edition is promoted to live ONLY when every check passes; the edition it
// replaces is never retired or removed until then, so a failed certification leaves the current form serving cases untouched.
//
// Checks (all deterministic, no AI):
//   pdf_fillable          the stored PDF loads (qpdf-normalized, XFA-free), exposes AcroForm fields, and every scanned field is present
//   mapping_valid         the active mapping graph validates with zero errors, is non-empty, and (rule-driven forms) holds only rule-verified edges
//   party_markers         (Phase 3) distinct synthetic markers per party are resolved through the real mapper: each person's data may only land in that person's boxes
//   widget_inputs         (Phase 3) tick boxes get booleans, drop-downs get a choice the renderer can select, dates are dates
//   fill_roundtrip        every mapped text field accepts a probe value, the PDF saves, reloads, and reads each probe back - i.e. the filled form is NOT blank
//   viewer_download       the filled bytes are a valid PDF with the template's page count (what the case manager sees, edits and downloads)
//   components_slice      every component / supplement the previous edition served can be sliced from this edition
// The report is stored on the template (importMetadata.validationSummary.certification) so the Admin registry can show it.
const fs = require("fs/promises");
const path = require("path");
const logger = require("../../../utils/logger");
const MappingGraphService = require("./MappingGraphService");

const PROBE = "7";
const SKIP_TYPES = new Set(["checkbox", "radio", "signature", "button", "dropdown", "select"]);

async function run(checks, name, task) {
  const started = Date.now();
  try {
    const detail = await task();
    checks.push({ name, passed: true, detail: detail || "ok", ms: Date.now() - started });
  } catch (error) {
    checks.push({ name, passed: false, detail: error.message, ms: Date.now() - started });
  }
}

const fail = (message) => { throw new Error(message); };

// edition strings such as "07/22/2025" are not valid file-name parts
const safeName = (value) => String(value).replace(/[^A-Za-z0-9._-]+/g, "-");

async function loadPdf(template) {
  const PDFRenderer = require("../../form-generation/services/PDFRenderer");
  const { PDFDocument } = PDFRenderer.loadPdfLib();
  const pdf = await PDFRenderer.loadTemplatePdf(template, PDFDocument);
  return { PDFRenderer, PDFDocument, pdf };
}

// Writes a JSON snapshot (template identity, field list, mapping graph) next to the other backups before anything is activated or replaced.
async function backupTemplate(template, graph) {
  try {
    const dir = path.resolve(__dirname, "../../../../backups/forms");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${safeName(template.formCode)}-${safeName(template.version || "unknown")}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await fs.writeFile(file, JSON.stringify({ formCode: template.formCode, version: template.version, status: template.status, mappingStatus: template.mappingStatus, pdfStorageKey: template.pdfStorageKey, fieldCount: (template.formFields || []).length, graph }, null, 1));
    return file;
  } catch (error) {
    logger.info("form_backup_failed", { formCode: template.formCode, error: error.message });
    return null;
  }
}

async function certify(template, { previous = null, persist = true } = {}) {
  const checks = [];
  // a form with nothing for a case to fill (config/partyFormSpecs.js NO_MAPPING_FORMS: a fee schedule, a form no case holds data for) is certified on the PDF itself - it has no mapping
  // to validate and no value to write; every other check still runs
  const noMapping = require("../config/partyFormSpecs").NO_MAPPING_FORMS.has(template.formCode);
  const graph = await MappingGraphService.loadCurrentGraph(template).catch(() => ({ edges: [] }));
  const fieldNames = new Set((template.formFields || []).map((field) => field.pdfFieldName || field.fieldName || field.originalName).filter(Boolean));

  await run(checks, "pdf_fillable", async () => {
    const { pdf } = await loadPdf(template);
    const count = pdf.getForm().getFields().length;
    if (!count) fail("the stored PDF exposes 0 fillable fields");
    const expected = (template.formFields || []).length;
    if (expected && count < expected) fail(`the PDF has ${count} fields but ${expected} were scanned`);
    return `${count} fields`;
  });

  await run(checks, "mapping_valid", async () => {
    if (noMapping && !(graph.edges || []).length) return "nothing for a case to fill - released without a mapping";
    if (!(graph.edges || []).length) fail("the mapping graph is empty");
    const validation = await MappingGraphService.validateWithContract(graph, template);
    if (validation.errors?.length) fail(`${validation.errors.length} mapping errors, first: ${JSON.stringify(validation.errors[0]).slice(0, 200)}`);
    const dangling = graph.edges.filter((edge) => edge.status === "active" && edge.targetPdfField && fieldNames.size && !fieldNames.has(edge.targetPdfField));
    if (dangling.length) fail(`${dangling.length} active edges point at PDF fields that do not exist (e.g. ${dangling[0].targetPdfField})`);
    const { EXCLUSIVE_FORMS } = require("../config/partyFieldRules");
    if (EXCLUSIVE_FORMS.has(template.formCode)) {
      const unverified = graph.edges.filter((edge) => edge.status === "active" && !edge.partyRule);
      if (unverified.length) fail(`${unverified.length} active edges are not backed by a verified rule`);
    }
    return `${graph.edges.length} edges${validation.contract?.summary?.legacyViolations ? `, ${validation.contract.summary.legacyViolations} legacy findings (report only)` : ""}`;
  });

  // Phase 3: prove WHO each box is filled with and that each kind of box gets a value it can hold (in memory; the policy that makes both critical is form-release/certPolicy.js)
  const targetsById = new Map();
  (template.formFields || []).forEach((field) => { if (field.fieldId) targetsById.set(field.fieldId, field); if (field.uniqueId) targetsById.set(field.uniqueId, field); });
  await run(checks, "party_markers", async () => {
    const report = require("../../form-release/markerCertification").partyMarkerReport({ graph, targetsById });
    if (report.violations.length) fail(`${report.violations.length} box(es) would receive the wrong party's data, first: ${report.violations[0].field}: ${report.violations[0].reason}`);
    return `${report.checked} mapped boxes traced to the right party (${report.unobserved} not observable${report.advisories.length ? `, ${report.advisories.length} advisories` : ""})`;
  });
  await run(checks, "widget_inputs", async () => {
    const report = require("../../form-release/markerCertification").widgetInputReport({ graph, targetsById });
    if (report.violations.length) fail(`${report.violations.length} box(es) would get a value they cannot hold, first: ${report.violations[0].field}: ${report.violations[0].reason}`);
    return `${report.checked} mapped boxes given a valid value (${report.unobserved} not observable)`;
  });

  let filledBytes = null;
  await run(checks, "fill_roundtrip", async () => {
    const { PDFRenderer, PDFDocument, pdf } = await loadPdf(template);
    const form = pdf.getForm();
    const written = [];
    for (const edge of graph.edges || []) {
      if (edge.status !== "active" || SKIP_TYPES.has(String(edge.targetType || "").toLowerCase())) continue;
      if (PDFRenderer.setFormField(form, { pdfField: edge.targetPdfField, value: PROBE, type: "text" }, template.formCode)) written.push(edge.targetPdfField);
    }
    if (!written.length && noMapping && !(graph.edges || []).length) {
      // nothing to fill: prove the PDF itself saves and reloads, which is what the viewer / download serve
      filledBytes = Buffer.from(await pdf.save());
      await PDFDocument.load(filledBytes, { ignoreEncryption: true });
      return "no mapped fields (nothing for a case to fill); the PDF saves and reloads";
    }
    if (!written.length) fail("no mapped field accepted a value - the filled form would be blank");
    // the real render path (PDFRenderer) runs this before save(); an empty rich-text field otherwise makes pdf-lib's updateFieldAppearances throw
    require("../../form-generation/services/RichTextFieldGuard").disableEmptyRichTextFields(form);
    filledBytes = Buffer.from(await pdf.save());
    const reloaded = await PDFDocument.load(filledBytes, { ignoreEncryption: true });
    const reloadedForm = reloaded.getForm();
    const lost = written.filter((name) => { try { return reloadedForm.getTextField(name).getText() !== PROBE; } catch (_) { return true; } });
    if (lost.length) fail(`${lost.length}/${written.length} written values did not survive save/reload (e.g. ${lost[0]})`);
    return `${written.length} mapped fields filled and read back`;
  });

  await run(checks, "viewer_download", async () => {
    if (!filledBytes) fail("no filled PDF was produced");
    const { PDFDocument, pdf } = await loadPdf(template);
    const reloaded = await PDFDocument.load(filledBytes, { ignoreEncryption: true });
    if (filledBytes.subarray(0, 5).toString("utf8") !== "%PDF-") fail("the filled output is not a PDF");
    if (reloaded.getPageCount() !== pdf.getPageCount()) fail(`page count changed (${pdf.getPageCount()} -> ${reloaded.getPageCount()})`);
    return `${reloaded.getPageCount()} pages, ${filledBytes.length} bytes`;
  });

  // Phase 7.6a (FORM_PIPELINE_AUTONOMY): the probe renders the edition's own PDF in memory with very long / typed / ticked values and checks the final file. 'on' records the two
  // checks in the certification (critical, see certPolicy); 'shadow' only logs what they would say; 'off' does nothing at all.
  const probeMode = require("../../../config/formPipelineAutonomy").mode();
  if (probeMode !== "off") {
    let probe = null;
    const probeOnce = async () => { probe = probe || (await require("../../form-release/artifactCertification").probeEdition(template, { graph })); return probe; };
    const describeFailures = (list) => list.slice(0, 3).map((failure) => `${failure.check}${failure.field ? ` ${failure.field}` : ""}: ${failure.detail}`).join("; ");
    if (probeMode === "on") {
      await run(checks, "data_probe", async () => {
        const result = await probeOnce();
        if (!result.data.ok) fail(`${result.data.failures.length} box(es) did not keep their data, first: ${describeFailures(result.data.failures)}`);
        return `${result.data.checked} boxes kept their full data`;
      });
      await run(checks, "artifact_probe", async () => {
        const result = await probeOnce();
        if (!result.artifact.ok) fail(`${result.artifact.failures.length} problem(s) in the final file, first: ${describeFailures(result.artifact.failures)}`);
        return `${result.artifact.stats.pages} pages, ${result.artifact.stats.measured} text boxes measured, ${result.artifact.stats.ticks} ticks visible`;
      });
    } else {
      try {
        const result = await probeOnce();
        logger.warn("form_certification_probe_shadow", { formCode: template.formCode, version: template.version, dataOk: result.data.ok, artifactOk: result.artifact.ok, wouldFail: [...result.data.failures, ...result.artifact.failures].slice(0, 5) });
      } catch (error) {
        logger.warn("form_certification_probe_shadow_failed", { formCode: template.formCode, error: error.message });
      }
    }
  }

  await run(checks, "components_slice", async () => {
    const { checkEditionReady } = require("./EditionMigrationService");
    const readiness = await checkEditionReady(template, previous);
    if (!readiness.ready) fail(readiness.problems.join("; "));
    // Phase 7.5 (FORM_PIPELINE_AUTONOMY=on only): the check is no longer satisfied by "nothing to compare with" - every page after the first supplement must belong to a
    // component, an unregistered supplement is a problem to resolve, every active component must have fields, and a component the previous edition served keeps a plausible size
    const autonomyMode = require("../../../config/formPipelineAutonomy").mode();
    if (autonomyMode !== "off") {
      const { evaluateComponentSlice } = require("../../uscis-forms/services/ComponentSegmenter");
      const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");
      const previousDefs = previous ? await USCISFormComponentDefinition.find({ parentTemplateId: previous._id, status: "ACTIVE" }).select("componentCode pageRanges fieldIds").lean() : [];
      const sliceProblems = evaluateComponentSlice({ results: readiness.components, totalPages: Number(template.pdfMetadata?.pageCount) || 0, previousDefs: previousDefs.map((def) => ({ componentCode: def.componentCode, pageRanges: def.pageRanges, fieldCount: (def.fieldIds || []).length })) });
      if (sliceProblems.length) {
        if (autonomyMode === "on") fail(sliceProblems.join("; "));
        logger.warn("form_certification_components_slice_shadow", { formCode: template.formCode, version: template.version, wouldFail: sliceProblems });
      }
    }
    return `${readiness.components.length} components`;
  });

  const report = { passed: checks.every((check) => check.passed), certifiedAt: new Date(), version: template.version, checks };
  // Phase 7.6a ('on' only): the certification is bound to the mapping version it tested (ReleaseGate rejects it once the mapping has changed)
  if (require("../../../config/formPipelineAutonomy").mode() === "on") {
    const versionId = template.activeMappingVersionId || template.latestMappingVersionId;
    if (versionId) {
      report.mappingVersionId = String(versionId);
      try { report.graphChecksum = (await require("../../../models/USCISMappingVersion").findById(versionId).select("checksum").lean())?.checksum; } catch (error) { /* the id alone binds it */ }
    }
  }
  // the coverage report of the mapping that was just certified is kept with its mapping version (never on the template document: I-129 is near the 16 MB limit)
  if (persist) {
    try {
      const contract = require("../contract");
      const coverage = contract.computeCoverage({ template, graph, universe: await contract.loadPathUniverse(), getTemplateFields: (item) => MappingGraphService.getTemplateFields(item) });
      coverage.generatedAt = new Date().toISOString();
      await contract.persistCoverage(template.activeMappingVersionId || template.latestMappingVersionId, coverage);
    } catch (error) {
      logger.info("form_coverage_persist_failed", { formCode: template.formCode, error: error.message });
    }
  }
  if (persist && template.save) {
    try {
      template.importMetadata = template.importMetadata || {};
      template.importMetadata.validationSummary = { ...(template.importMetadata.validationSummary || {}), certification: report };
      template.markModified("importMetadata");
      await template.save();
    } catch (error) {
      logger.info("form_certification_persist_failed", { formCode: template.formCode, error: error.message });
    }
  }
  logger.info("form_certification_completed", { formCode: template.formCode, version: template.version, passed: report.passed, failed: checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`) });
  return report;
}

module.exports = { certify, backupTemplate };
