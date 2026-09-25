// Root cause (confirmed empirically against the real I-129 template, both
// via raw-byte inspection and live Adobe PDF Services calls): USCIS's
// official PDFs are hybrid XFA+AcroForm ("LiveCycle Designer" forms). The
// AcroForm dictionary's /XFA entry is an array of [name, streamRef, ...]
// pairs pointing at the actual embedded XFA template package (a multi-
// megabyte XML data stream). pdf-lib's own save() DOES remove the /XFA KEY
// from the AcroForm dictionary (hence the "Removing XFA form data..."
// console warning it prints), but it does NOT delete the underlying XFA
// stream OBJECTS themselves - they become orphaned/unreferenced but remain
// physically embedded in the saved file's object table. Adobe PDF
// Services' XFA detection scans the document for this leftover package
// (not merely the /XFA dictionary key), so a merely-pdf-lib-resaved buffer
// is still rejected by BOTH setformdata and combinepdf with "Source PDF is
// a XFA Form and cannot be processed" - confirmed to reproduce even after
// one full pdf-lib load+save pass, and even after being round-tripped
// through Adobe's own setformdata once already.
//
// Fix: walk the AcroForm's /XFA array (or single stream ref - both shapes
// are valid per the PDF spec) and explicitly delete every referenced
// indirect object from pdf-lib's document context BEFORE saving, so the
// orphaned package is truly gone from the output bytes, not just unlinked.
// Confirmed empirically: after this purge, Adobe's slicePdf (combinepdf)
// and fillPdf (setformdata) both accept the resulting buffer, and the
// document's AcroForm fields remain fully intact (field COUNT and
// fillability unaffected - only the dead XFA package bytes are removed).
//
// Idempotent and safe to call on any PDFDocument, including one with no
// XFA data at all (no-op in that case).
function purgeOrphanedXfaObjects(pdfDocument) {
  const { PDFName, PDFRef } = require("pdf-lib");
  const acroFormRef = pdfDocument.catalog.get(PDFName.of("AcroForm"));
  if (!acroFormRef) return { purgedObjectCount: 0 };
  const acroForm = pdfDocument.context.lookup(acroFormRef);
  if (!acroForm || typeof acroForm.get !== "function") return { purgedObjectCount: 0 };
  const xfaEntry = acroForm.get(PDFName.of("XFA"));
  if (!xfaEntry) return { purgedObjectCount: 0 };

  let purgedObjectCount = 0;
  function deleteRefsIn(node) {
    if (node instanceof PDFRef) {
      pdfDocument.context.delete(node);
      purgedObjectCount += 1;
      return;
    }
    // The /XFA value is either a single stream ref or an array alternating
    // [name, streamRef, name, streamRef, ...] per the PDF spec (ISO
    // 32000-2 §12.7.8) - PDFArray exposes its elements via `.array`.
    if (node && Array.isArray(node.array)) {
      node.array.forEach(deleteRefsIn);
    }
  }
  deleteRefsIn(xfaEntry);
  acroForm.delete(PDFName.of("XFA"));
  return { purgedObjectCount };
}

module.exports = { purgeOrphanedXfaObjects };
