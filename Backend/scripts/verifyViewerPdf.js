#!/usr/bin/env node
// Read-only diagnostic for the interactive-form VIEWER PDF (never the
// filled-download PDF). For a template (and optionally one component),
// compares per-page widget counts in the parent PDF against the PDF the
// viewer endpoint actually serves, and checks that barcode pages carry the
// flattened barcode XObject.
//
// Usage:
//   node scripts/verifyViewerPdf.js --template=<templateId> [--component=<componentCode>] [--recipe=current|legacy]
//   node scripts/verifyViewerPdf.js --template=<templateId> --all-components
//
// --recipe=legacy reproduces the pre-fix getComponentPdf sequence
// (purge XFA -> Adobe slice -> repair /Fields, with NO barcode
// flatten/removeField step) so before/after parity can be measured
// side by side without checking out old code. Exits non-zero on any FAIL.
require("dotenv").config();
const mongoose = require("mongoose");

function parseArgs(argv) {
  const args = {};
  argv.slice(2).forEach((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    args[key] = value === undefined ? true : value;
  });
  return args;
}

async function legacyViewerPdf({ rawBuffer, pagesToKeep }) {
  const PDFRenderer = require("../src/modules/form-generation/services/PDFRenderer");
  const { purgeOrphanedXfaObjects } = require("../src/modules/form-generation/services/XfaPurgeGuard");
  const { rebuildAcroFormFieldsFromWidgets } = require("../src/modules/form-generation/services/AcroFormRepairGuard");
  const AdobePdfService = require("../src/modules/pdf-services/AdobePdfService");
  const { toAdobeRanges } = require("../src/modules/form-generation/services/ViewerPdfPreparationService");
  const { PDFDocument } = PDFRenderer.loadPdfLib();
  const rawPdf = await PDFDocument.load(rawBuffer, { ignoreEncryption: true, updateMetadata: false });
  purgeOrphanedXfaObjects(rawPdf);
  const cleaned = Buffer.from(await rawPdf.save());
  if (!pagesToKeep) return cleaned;
  const sliced = await AdobePdfService.slicePdf(cleaned, toAdobeRanges(pagesToKeep));
  const slicedDoc = await PDFDocument.load(sliced, { ignoreEncryption: true, updateMetadata: false });
  rebuildAcroFormFieldsFromWidgets(slicedDoc);
  return Buffer.from(await slicedDoc.save());
}

async function verifyOne({ template, rawBuffer, componentDef, recipe }) {
  const PDFRenderer = require("../src/modules/form-generation/services/PDFRenderer");
  const ComponentPageResolver = require("../src/modules/form-generation/services/ComponentPageResolver");
  const Viewer = require("../src/modules/form-generation/services/ViewerPdfPreparationService");
  const { PDFDocument } = PDFRenderer.loadPdfLib();

  const parentDoc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true, updateMetadata: false });
  const totalPages = parentDoc.getPageCount();
  const { widgetsByPage, barcodeWidgetsByPage } = Viewer.countWidgetsByPage(parentDoc, template.formCode);

  const pagesToKeep = componentDef
    ? ComponentPageResolver.expandPageRanges(componentDef.pageRanges, totalPages, {
      componentCode: componentDef.componentCode,
      parentFormCode: template.formCode,
    })
    : null;

  let viewerBuffer;
  let report = null;
  if (recipe === "legacy") {
    viewerBuffer = await legacyViewerPdf({ rawBuffer, pagesToKeep });
  } else {
    const prepared = await Viewer.prepareViewerPdf({ rawBuffer, template, pagesToKeep });
    viewerBuffer = prepared.buffer;
    report = prepared.report;
  }

  const viewerDoc = await PDFDocument.load(viewerBuffer, { ignoreEncryption: true, updateMetadata: false });
  const { perPage } = Viewer.countWidgetsPerDocument(viewerDoc);
  const viewerPages = viewerDoc.getPages();
  const pageList = pagesToKeep || Array.from({ length: totalPages }, (_, i) => i + 1);

  const { PDFName } = PDFRenderer.loadPdfLib();
  const acroFormRef = viewerDoc.catalog.get(PDFName.of("AcroForm"));
  const acroForm = acroFormRef ? viewerDoc.context.lookup(acroFormRef) : null;
  const fieldsArray = acroForm?.get?.(PDFName.of("Fields"));
  const fieldsRoots = fieldsArray?.size ? fieldsArray.size() : 0;
  let pdfLibFieldCount = null;
  try { pdfLibFieldCount = viewerDoc.getForm().getFields().length; } catch (error) { pdfLibFieldCount = `error: ${error.message}`; }

  const rows = [];
  let anyFail = false;
  pageList.forEach((parentPage, index) => {
    const slot = index + 1;
    const parentWidgets = widgetsByPage[parentPage] || 0;
    const parentBarcodeWidgets = barcodeWidgetsByPage[parentPage] || 0;
    const expected = parentWidgets - parentBarcodeWidgets;
    const viewerWidgets = perPage[slot - 1] ?? 0;
    const barcodeBaked = parentBarcodeWidgets > 0 ? Viewer.pageHasFlattenedBarcode(viewerPages[slot - 1]) : null;
    const pass = viewerWidgets >= expected && (parentBarcodeWidgets === 0 || barcodeBaked === true);
    if (!pass) anyFail = true;
    rows.push({ parentPage, slot, parentWidgets, parentBarcodeWidgets, viewerWidgets, expected, barcodeBaked, result: pass ? "PASS" : "FAIL" });
  });

  const pageCountOk = viewerDoc.getPageCount() === pageList.length;
  if (!pageCountOk) anyFail = true;

  return {
    component: componentDef?.componentCode || "(core/full)",
    recipe,
    strategy: report?.strategy || (recipe === "legacy" ? "legacy_adobe_combine_no_flatten" : "n/a"),
    viewerPageCount: viewerDoc.getPageCount(),
    expectedPageCount: pageList.length,
    pageCountOk,
    fieldsRoots,
    pdfLibFieldCount,
    flattenedBarcodeFields: report?.flattenedBarcodeFields?.length ?? null,
    rows,
    anyFail,
  };
}

function printResult(result) {
  console.log(`\n=== ${result.component} | recipe=${result.recipe} | strategy=${result.strategy} ===`);
  console.log(`pages: viewer=${result.viewerPageCount} expected=${result.expectedPageCount} ${result.pageCountOk ? "OK" : "MISMATCH"} | /Fields roots=${result.fieldsRoots} | pdf-lib getFields()=${result.pdfLibFieldCount} | flattenedBarcodeFields=${result.flattenedBarcodeFields}`);
  console.log("parentPage | slot | parentWidgets | parentBarcodeWidgets | viewerWidgets | expected | barcodeBaked | result");
  result.rows.forEach((r) => {
    console.log(`${String(r.parentPage).padStart(10)} | ${String(r.slot).padStart(4)} | ${String(r.parentWidgets).padStart(13)} | ${String(r.parentBarcodeWidgets).padStart(20)} | ${String(r.viewerWidgets).padStart(13)} | ${String(r.expected).padStart(8)} | ${String(r.barcodeBaked).padStart(12)} | ${r.result}`);
  });
  console.log(`OVERALL: ${result.anyFail ? "FAIL" : "PASS"}`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.template) {
    console.error("Usage: node scripts/verifyViewerPdf.js --template=<templateId> [--component=<code> | --all-components] [--core] [--recipe=current|legacy]");
    process.exit(2);
  }
  const recipe = args.recipe || "current";
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGODB_TEST_URI);
  const USCISFormTemplate = require("../src/models/USCISFormTemplate");
  const USCISFormComponentDefinition = require("../src/models/USCISFormComponentDefinition");
  const storageService = require("../src/modules/uploads/storage.service");

  const template = await USCISFormTemplate.findById(args.template).select("formCode version artifacts pdfStorageKey pdfMetadata").lean();
  if (!template) throw new Error(`Template ${args.template} not found`);
  const key = template.artifacts?.form?.storageKey || template.pdfStorageKey;
  const rawBuffer = await storageService.readBuffer(key);

  const targets = [];
  if (args.core || (!args.component && !args["all-components"])) targets.push(null);
  if (args.component) {
    const def = await USCISFormComponentDefinition.findOne({ parentTemplateId: template._id, componentCode: args.component, status: "ACTIVE" }).lean();
    if (!def) throw new Error(`No ACTIVE component ${args.component}`);
    targets.push(def);
  }
  if (args["all-components"]) {
    const defs = await USCISFormComponentDefinition.find({ parentTemplateId: template._id, status: "ACTIVE" }).sort({ "pageRanges.0.startPage": 1 }).lean();
    targets.push(...defs);
  }

  let anyFail = false;
  const summary = [];
  for (const componentDef of targets) {
    try {
      const result = await verifyOne({ template, rawBuffer, componentDef, recipe });
      printResult(result);
      if (result.anyFail) anyFail = true;
      summary.push({ component: result.component, strategy: result.strategy, result: result.anyFail ? "FAIL" : "PASS" });
    } catch (error) {
      anyFail = true;
      console.log(`\n=== ${componentDef?.componentCode || "(core/full)"} | recipe=${recipe} === ERROR: ${error.code || ""} ${error.message}`);
      if (error.details) console.log(JSON.stringify(error.details, null, 2));
      summary.push({ component: componentDef?.componentCode || "(core/full)", strategy: "error", result: "FAIL" });
    }
  }
  console.log("\n=== SUMMARY ===");
  summary.forEach((s) => console.log(`${s.component.padEnd(34)} ${s.strategy.padEnd(32)} ${s.result}`));
  await mongoose.disconnect();
  process.exit(anyFail ? 1 : 0);
}

main().catch(async (error) => {
  console.error("verifyViewerPdf failed:", error.stack || error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
