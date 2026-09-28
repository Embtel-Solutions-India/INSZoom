// Resolves the slot/parentPage mapping the USCIS form viewer needs.
//
// `slot` = the 1-based page index inside the PDF actually loaded into
// react-pdf's <Document> (a component CaseForm loads an Adobe-sliced,
// renumbered-1..N copy of just its own pages; a core/full CaseForm loads the
// complete parent PDF, so slot === parentPage there).
// `parentPage` = the official USCIS page number - used for every label,
// `fieldsByPage`/`pageDimensionsByNumber` lookup (both keyed by parent page,
// unchanged), the page rail, and scroll targets.
//
// Root cause this fixes: previously the same `pageNumber` (always the
// parent number) was passed straight to <Page pageNumber>, so for a
// component (an N-page sliced PDF) react-pdf was asked to render parent
// page numbers like 20-28 out of an 8-page document - throwing
// "Invalid page request" for every page past N and mislabeling whichever
// pages happened to exist.
export function buildPageSlots({ viewerPageConstraint, headerPageMap, pdfPageCount, fieldsByPage, pageDimensionsByNumber }) {
  let slots;

  if (Array.isArray(headerPageMap) && headerPageMap.length) {
    slots = headerPageMap.map(({ slot, parentPage }) => ({ slot, parentPage }));
  } else if (Array.isArray(viewerPageConstraint?.pageMap) && viewerPageConstraint.pageMap.length) {
    slots = viewerPageConstraint.pageMap.map(({ slot, parentPage }) => ({ slot, parentPage }));
  } else if (viewerPageConstraint?.type === 'core' && Array.isArray(viewerPageConstraint.pages)) {
    // Core loads the full parent PDF - slot === parentPage.
    slots = viewerPageConstraint.pages.map((parentPage) => ({ slot: parentPage, parentPage }));
  } else {
    // No authoritative map yet (still loading, or a full/legacy CaseForm) -
    // fall back to the union of whatever page numbers are already known,
    // identity-mapped, exactly like the previous unconstrained behavior.
    const fromDims = pageDimensionsByNumber ? [...pageDimensionsByNumber.keys()] : [];
    const fromFields = fieldsByPage ? [...fieldsByPage.keys()] : [];
    const fromPdf = pdfPageCount ? Array.from({ length: pdfPageCount }, (_, index) => index + 1) : [];
    const all = [...new Set([...fromDims, ...fromFields, ...fromPdf])].sort((a, b) => a - b);
    slots = all.map((page) => ({ slot: page, parentPage: page }));
  }

  // Once the PDF has actually loaded and its real page count is known,
  // never let a stale/mismatched map ask react-pdf for a slot beyond it -
  // that is exactly the "Invalid page request" / "Unable to render page"
  // failure this whole fix targets.
  if (pdfPageCount > 0) {
    slots = slots.filter((entry) => entry.slot <= pdfPageCount);
  }

  return slots;
}

// Returns a human-readable warning when the resolved slots don't agree with
// the PDF that actually loaded or with what the backend told us to expect -
// used to show a visible banner instead of silently rendering a partial or
// wrong page set.
export function pageMismatch(slots, pdfPageCount, expectedPdfPageCount) {
  if (pdfPageCount > 0 && expectedPdfPageCount != null && pdfPageCount !== expectedPdfPageCount) {
    return `Expected ${expectedPdfPageCount} page(s) but the loaded PDF has ${pdfPageCount}.`;
  }
  if (pdfPageCount > 0 && slots.length === 0) {
    return `The PDF loaded with ${pdfPageCount} page(s), but no page mapping could be resolved.`;
  }
  return null;
}
