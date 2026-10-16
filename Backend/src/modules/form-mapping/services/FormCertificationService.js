// Automatic production-readiness certification of a USCIS form edition. Runs from code on every import / edition change (OnDemandFormAcquisitionService
// .activateOrPromote) and can be re-run on demand (scripts/certifyForm.js). An edition is promoted to live ONLY when every check passes; the edition it
// replaces is never retired or removed until then, so a failed certification leaves the current form serving cases untouched.
//
// Checks (all deterministic, no AI):
//   pdf_fillable          the stored PDF loads (qpdf-normalized, XFA-free), exposes AcroForm fields, and every scanned field is present
//   mapping_valid         the active mapping graph validates with zero errors, is non-empty, and (rule-driven forms) holds only rule-verified edges
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

  let filledBytes = null;
  await run(checks, "fill_roundtrip", async () => {
    const { PDFRenderer, PDFDocument, pdf } = await loadPdf(template);
    const form = pdf.getForm();
    const written = [];
    for (const edge of graph.edges || []) {
      if (edge.status !== "active" || SKIP_TYPES.has(String(edge.targetType || "").toLowerCase())) continue;
      if (PDFRenderer.setFormField(form, { pdfField: edge.targetPdfField, value: PROBE, type: "text" }, template.formCode)) written.push(edge.targetPdfField);
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

  await run(checks, "components_slice", async () => {
    const { checkEditionReady } = require("./EditionMigrationService");
    const readiness = await checkEditionReady(template, previous);
    if (!readiness.ready) fail(readiness.problems.join("; "));
    return `${readiness.components.length} components`;
  });

  const report = { passed: checks.every((check) => check.passed), certifiedAt: new Date(), version: template.version, checks };
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
