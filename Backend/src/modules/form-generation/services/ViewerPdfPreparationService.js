// Prepares the BLANK viewer PDF served by the interactive form renderer
// (uscis-form.controller.js's getComponentPdf and getTemplatePdf?purpose=
// viewer) - never the filled-download path (AdobeFormRenderer.js /
// PDFRenderer.js), which is untouched by this file.
//
// Root cause this exists to fix (confirmed empirically this session, see
// AcroFormRepairGuard.js's own header comment): Adobe's combinepdf behaves
// differently depending on whether the source document's AcroForm field
// tree was structurally pruned via pdf-lib's PDFForm.removeField() before
// upload.
//   - Without any removeField() call: combinepdf KEEPS the catalog's
//     /AcroForm dict, but silently drops ~97% of the real widget
//     annotations from the kept pages (measured: 4 of 159 survive).
//   - With removeField() having run (flattenBarcodeAppearances calls it once
//     per barcode field): combinepdf drops /AcroForm from the catalog, but
//     ALL widgets survive on the kept pages (measured: 159/159) -
//     AcroFormRepairGuard then rebuilds /Fields from those surviving
//     widgets.
// The filled-download path (AdobeFormRenderer.js) already runs
// flattenBarcodeAppearances before slicing for exactly this reason. The
// blank-viewer path (getComponentPdf) did not - it only purged XFA before
// slicing - which is why the viewer showed only 4-5 fillable fields and no
// barcode even though the download PDF for the same component was correct.
const PDFRenderer = require("./PDFRenderer");
const AdobePdfService = require("../../pdf-services/AdobePdfService");
const { flattenBarcodeAppearances, hasImageAppearance } = require("./BarcodeAppearanceGuard");
const { isProtectedField } = require("./ProtectedFieldPolicy");
const { disableEmptyRichTextFields } = require("./RichTextFieldGuard");
const { purgeOrphanedXfaObjects } = require("./XfaPurgeGuard");
const { rebuildAcroFormFieldsFromWidgets } = require("./AcroFormRepairGuard");
const { keepOnlyPages } = require("./ComponentPageResolver");
const logger = require("../../../utils/logger");

// Bump whenever this recipe changes - part of every viewer-slice cache key
// (USCISFormComponentDefinition.slicedPdfRecipeVersion) so a code fix alone
// invalidates every previously-cached (broken) slice without a data
// migration.
const VIEWER_PDF_RECIPE_VERSION = 2;

// Converts a flat, sorted, 1-based page list into the contiguous
// {start, end} ranges Adobe's combinepdf API requires. Moved here (out of
// AdobeFormRenderer.js) so both the download and viewer paths import one
// implementation instead of keeping two copies in sync.
function toAdobeRanges(pages1Based) {
  if (!pages1Based || !pages1Based.length) return null;
  const sorted = [...pages1Based].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let end = sorted[0];
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] === end + 1) {
      end = sorted[i];
    } else {
      ranges.push({ start, end });
      start = end = sorted[i];
    }
  }
  ranges.push({ start, end });
  return ranges;
}

function isWidgetAnnot(annot) {
  const { PDFName } = requirePdfLibNames();
  if (!annot || typeof annot.get !== "function") return false;
  const subtype = annot.get(PDFName.of("Subtype"));
  return Boolean(subtype && subtype.toString() === "/Widget");
}

let _pdfLibNames = null;
function requirePdfLibNames() {
  if (_pdfLibNames) return _pdfLibNames;
  const { PDFName, PDFRef } = PDFRenderer.loadPdfLib();
  _pdfLibNames = { PDFName, PDFRef };
  return _pdfLibNames;
}

// Counts real Widget annotations per 1-based page number, and separately how
// many of those are protected, image-backed barcode fields (which
// flattenBarcodeAppearances will remove from the AcroForm entirely, baking
// them into page content instead) - so "expected surviving widgets after
// flattening" = widgets - barcodeWidgets, never the raw widget count.
function countWidgetsByPage(pdfDocument, formCode) {
  const { PDFRef } = requirePdfLibNames();
  const form = pdfDocument.getForm();
  const barcodeFieldNames = new Set(
    form.getFields()
      .filter((field) => isProtectedField(field.getName(), formCode) && hasImageAppearance(field))
      .map((field) => field.getName())
  );

  const widgetsByPage = {};
  const barcodeWidgetsByPage = {};
  pdfDocument.getPages().forEach((page, index) => {
    const pageNumber = index + 1;
    let widgetCount = 0;
    let barcodeCount = 0;
    const annots = page.node.Annots();
    if (annots) {
      for (let i = 0; i < annots.size(); i += 1) {
        const ref = annots.get(i);
        if (!(ref instanceof PDFRef)) continue;
        const annot = pdfDocument.context.lookup(ref);
        if (!isWidgetAnnot(annot)) continue;
        widgetCount += 1;
        const fieldName = resolveWidgetFieldName(pdfDocument, annot);
        if (fieldName && barcodeFieldNames.has(fieldName)) barcodeCount += 1;
      }
    }
    widgetsByPage[pageNumber] = widgetCount;
    barcodeWidgetsByPage[pageNumber] = barcodeCount;
  });
  return { widgetsByPage, barcodeWidgetsByPage };
}

// A widget's own /T is often absent (terminal widgets merged into their
// parent field carry /T on that parent) - walk up /Parent to find the
// nearest fully-qualified name segment, matching how pdf-lib itself
// resolves a field's getName().
function resolveWidgetFieldName(pdfDocument, widgetDict) {
  const { PDFName, PDFRef } = requirePdfLibNames();
  const parts = [];
  let current = widgetDict;
  let guard = 0;
  while (current && guard <= 50) {
    const t = current.get?.(PDFName.of("T"));
    if (t) parts.unshift(t.decodeText ? t.decodeText() : String(t));
    const parentRef = current.get?.(PDFName.of("Parent"));
    if (!(parentRef instanceof PDFRef)) break;
    current = pdfDocument.context.lookup(parentRef);
    guard += 1;
  }
  return parts.join(".");
}

function countWidgetsPerDocument(pdfDocument) {
  const { PDFRef } = requirePdfLibNames();
  let total = 0;
  const perPage = [];
  pdfDocument.getPages().forEach((page) => {
    const annots = page.node.Annots();
    let count = 0;
    if (annots) {
      for (let i = 0; i < annots.size(); i += 1) {
        const ref = annots.get(i);
        if (!(ref instanceof PDFRef)) continue;
        const annot = pdfDocument.context.lookup(ref);
        if (isWidgetAnnot(annot)) count += 1;
      }
    }
    perPage.push(count);
    total += count;
  });
  return { total, perPage };
}

// Does this page's own /Resources /XObject dict contain the XObject
// flattenBarcodeAppearances draws the barcode's image into? pdf-lib's
// newXObject() names it via uniqueKey("FlatWidget") - a random numeric
// suffix, e.g. "/FlatWidget-6703682664" (confirmed live, and preserved
// verbatim through Adobe combinepdf) - so this matches by prefix, never
// the bare name. Diagnostics only (verifyViewerPdf.js).
function pageHasFlattenedBarcode(page) {
  const { PDFName } = requirePdfLibNames();
  const resources = page.node.Resources?.();
  if (!resources) return false;
  const xObjectDict = resources.lookup(PDFName.of("XObject"));
  if (!xObjectDict || typeof xObjectDict.keys !== "function") return false;
  return xObjectDict.keys().some((key) => key.toString().startsWith("/FlatWidget"));
}

/**
 * Prepares a viewer-ready PDF: barcode fields flattened into page content
 * (so they render as the real barcode image instead of a live, re-
 * rasterizable text widget), rich-text/XFA guards applied, and (when
 * `pagesToKeep` is given) sliced to exactly those parent pages with the
 * AcroForm's /Fields index rebuilt from the widgets that actually survive.
 *
 * @param {Buffer} rawBuffer - the raw, unmodified template PDF bytes
 * @param {{formCode: string}} template
 * @param {number[]|null} pagesToKeep - sorted 1-based PARENT page numbers to
 *   keep, or null to prepare the full document (core/full viewer case)
 * @returns {Promise<{ buffer: Buffer, report: object }>}
 */
async function prepareViewerPdf({ rawBuffer, template, pagesToKeep }) {
  const { PDFDocument } = PDFRenderer.loadPdfLib();
  const doc = await PDFDocument.load(rawBuffer, { ignoreEncryption: true, updateMetadata: false });

  const { widgetsByPage: expectedWidgetsByParentPage, barcodeWidgetsByPage: expectedBarcodeWidgetsByParentPage } =
    countWidgetsByPage(doc, template.formCode);

  const flattenedBarcodeFields = flattenBarcodeAppearances(doc.getForm(), template.formCode);
  const disabledRichTextFields = disableEmptyRichTextFields(doc.getForm());
  purgeOrphanedXfaObjects(doc);
  const prepared = Buffer.from(await doc.save());

  if (!pagesToKeep) {
    const fullDoc = await PDFDocument.load(prepared, { ignoreEncryption: true, updateMetadata: false });
    const pageMap = fullDoc.getPages().map((_, index) => ({ slot: index + 1, parentPage: index + 1 }));
    return {
      buffer: prepared,
      report: {
        recipeVersion: VIEWER_PDF_RECIPE_VERSION,
        strategy: "full",
        pageMap,
        flattenedBarcodeFields,
        disabledRichTextFields,
        expectedWidgetsByParentPage,
        parity: "PASS",
      },
    };
  }

  const expectedByParentPage = {};
  pagesToKeep.forEach((p) => {
    expectedByParentPage[p] = Math.max(0, (expectedWidgetsByParentPage[p] || 0) - (expectedBarcodeWidgetsByParentPage[p] || 0));
  });

  async function evaluateStrategyA() {
    const adobeRanges = toAdobeRanges(pagesToKeep);
    const sliced = await AdobePdfService.slicePdf(prepared, adobeRanges);
    const slicedDoc = await PDFDocument.load(sliced, { ignoreEncryption: true, updateMetadata: false });
    const acroFormRepair = rebuildAcroFormFieldsFromWidgets(slicedDoc);
    const finalBuffer = Buffer.from(await slicedDoc.save());
    return { finalBuffer, slicedDoc, acroFormRepair };
  }

  async function evaluateStrategyB() {
    const doc2 = await PDFDocument.load(prepared, { ignoreEncryption: true, updateMetadata: false });
    keepOnlyPages(doc2, pagesToKeep);
    const acroFormRepair = rebuildAcroFormFieldsFromWidgets(doc2);
    const finalBuffer = Buffer.from(await doc2.save());
    return { finalBuffer, slicedDoc: doc2, acroFormRepair };
  }

  function buildReportFor(strategyName, result) {
    const { perPage } = countWidgetsPerDocument(result.slicedDoc);
    const pageMap = pagesToKeep.map((parentPage, index) => ({ slot: index + 1, parentPage }));
    const survivingWidgetsBySlot = {};
    let parity = "PASS";
    pageMap.forEach(({ slot, parentPage }) => {
      const surviving = perPage[slot - 1] || 0;
      survivingWidgetsBySlot[slot] = surviving;
      if (surviving < expectedByParentPage[parentPage]) parity = "FAIL";
    });
    return {
      recipeVersion: VIEWER_PDF_RECIPE_VERSION,
      strategy: strategyName,
      pageMap,
      flattenedBarcodeFields,
      disabledRichTextFields,
      expectedWidgetsByParentPage: expectedByParentPage,
      survivingWidgetsBySlot,
      parity,
      acroFormRepair: result.acroFormRepair,
    };
  }

  const resultA = await evaluateStrategyA();
  let report = buildReportFor("adobe_combine", resultA);
  let finalBuffer = resultA.finalBuffer;

  if (report.parity === "FAIL") {
    logger.warn("viewer_pdf_slice_fallback", {
      formCode: template.formCode,
      strategyAParity: report,
    });
    const resultB = await evaluateStrategyB();
    const reportB = buildReportFor("pdflib_keep_pages", resultB);
    reportB.strategyAParity = report;
    report = reportB;
    finalBuffer = resultB.finalBuffer;
  }

  if (report.parity === "FAIL") {
    const error = new Error(`Viewer PDF parity check failed for both slicing strategies on ${template.formCode}`);
    error.status = 422;
    error.code = "VIEWER_PDF_PARITY_FAILED";
    error.details = report;
    throw error;
  }

  const finalDoc = await PDFDocument.load(finalBuffer, { ignoreEncryption: true, updateMetadata: false });
  if (finalDoc.getPageCount() !== pagesToKeep.length) {
    const error = new Error(
      `Viewer PDF page count mismatch: expected ${pagesToKeep.length}, got ${finalDoc.getPageCount()}`
    );
    error.status = 422;
    error.code = "VIEWER_PDF_PAGECOUNT_MISMATCH";
    error.details = report;
    throw error;
  }

  return { buffer: finalBuffer, report };
}

module.exports = {
  VIEWER_PDF_RECIPE_VERSION,
  prepareViewerPdf,
  countWidgetsByPage,
  countWidgetsPerDocument,
  toAdobeRanges,
  pageHasFlattenedBarcode,
};
