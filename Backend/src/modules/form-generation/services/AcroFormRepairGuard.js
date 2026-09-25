// Root cause (confirmed empirically against the real I-129 H Classification
// Supplement CaseForm, via direct structural inspection before/after a real
// Adobe combinepdf call): Adobe's combinepdf page-range extraction correctly
// carries over kept pages' content AND their /Annots-referenced widget
// objects (the actual on-page form-field boxes survive, fully intact, with
// their /FT, /T, /Parent, /AP, etc.) - but it does NOT reconstruct the
// document-level AcroForm's /Fields array to reference them. The original
// 38-page document's /Fields array (indexing all ~940+ top-level fields) is
// dropped to an empty array in combinepdf's output, even though the AcroForm
// dictionary itself (with /DR, /DA, /NeedAppearances) survives. This is a
// known category of limitation for generic "combine/extract pages" PDF
// operations: they operate on pages and their own annotation lists, not on
// the separate logical AcroForm field tree that indexes those widgets across
// the whole document - reconciling that tree against a reduced page set is a
// distinct operation most such tools don't perform.
//
// This is a LiveCycle-style form: ALL ~940+ fields across the entire
// 38-page document share ONE common top-level hierarchical ancestor
// (a single "form1[0]" subform container), not one root per field. So the
// fix is NOT "walk each surviving widget up to its root and re-link that
// root" - doing that just re-attaches the single shared ancestor, which
// still structurally contains every original Kid (including fields whose
// widgets lived on now-removed pages), reintroducing all ~940+ fields
// instead of only the ones that actually survive on the kept pages
// (confirmed empirically: that naive approach reported 942 fields after
// "repair" on an 8-page slice that only has 159 real surviving widgets).
//
// Correct fix: PRUNE the tree, don't just re-link it.
//   1. Find every surviving page's Widget annotations (the real, kept
//      fields - already proven intact post-slice).
//   2. Mark each surviving widget AND every one of its ancestors (walking
//      up /Parent) as "keep".
//   3. For every marked ancestor (a non-terminal field/subform node with
//      its own /Kids), rewrite its /Kids array to include ONLY the kids
//      that are also marked "keep" - dropping every sibling branch that
//      led to a widget on a page that no longer exists in this document.
//   4. The AcroForm's new /Fields array is exactly the marked nodes that
//      have no /Parent (the true roots of what's left after pruning).
// This never invents field data - it only keeps the exact subset of the
// original, still-present field tree that has a real widget on a page
// that actually survived the slice.
function rebuildAcroFormFieldsFromWidgets(pdfDocument) {
  const { PDFName, PDFArray, PDFRef } = require("pdf-lib");

  // Confirmed empirically (A/B tested against the real I-129 H Classification
  // Supplement, 3x repeated, deterministic - not flakiness): whenever the
  // source document sent to Adobe combinepdf has had ANY field removed via
  // pdf-lib's PDFForm.removeField() beforehand (flattenBarcodeAppearances
  // calls this once per barcode field), combinepdf's response drops the
  // catalog's /AcroForm entry entirely - even though it correctly copies
  // every kept page's real Widget annotations (159/159 confirmed intact,
  // each with its /Parent chain unchanged). Without removeField() having run
  // at all, combinepdf instead keeps /AcroForm but drops ~97% of the widgets
  // themselves (only 4/159 survive) - so removeField() is required upstream
  // (see BarcodeAppearanceGuard.js), and this guard must tolerate its
  // side effect of an absent /AcroForm rather than giving up: the real
  // field data is not lost, only the document-level index needs rebuilding
  // from the widgets that are provably still there.
  let acroFormRef = pdfDocument.catalog.get(PDFName.of("AcroForm"));
  let acroForm;
  if (!acroFormRef) {
    acroForm = pdfDocument.context.obj({ Fields: pdfDocument.context.obj([]) });
    acroFormRef = pdfDocument.context.register(acroForm);
    pdfDocument.catalog.set(PDFName.of("AcroForm"), acroFormRef);
  } else {
    acroForm = pdfDocument.context.lookup(acroFormRef);
    if (!acroForm || typeof acroForm.set !== "function") return { rebuiltFieldCount: 0, reason: "AcroForm dictionary not resolvable" };
  }

  // Step 1: collect every surviving Widget annotation ref across the kept pages.
  const survivingWidgetRefs = [];
  const seenWidgetTags = new Set();
  pdfDocument.getPages().forEach((page) => {
    const annots = page.node.Annots();
    if (!annots) return;
    for (let i = 0; i < annots.size(); i += 1) {
      const annotRef = annots.get(i);
      if (!(annotRef instanceof PDFRef) || seenWidgetTags.has(annotRef.tag)) continue;
      const annot = pdfDocument.context.lookup(annotRef);
      if (!annot || typeof annot.get !== "function") continue;
      const subtype = annot.get(PDFName.of("Subtype"));
      if (!subtype || subtype.toString() !== "/Widget") continue;
      seenWidgetTags.add(annotRef.tag);
      survivingWidgetRefs.push(annotRef);
    }
  });

  // Step 2: mark every surviving widget and its full ancestor chain "keep".
  const keepTags = new Set();
  const refByTag = new Map();
  function markChain(startRef) {
    let currentRef = startRef;
    let guard = 0;
    while (currentRef instanceof PDFRef && guard <= 50) { // 50: generous - real LiveCycle forms never nest this deep
      if (keepTags.has(currentRef.tag)) return; // already walked this ancestor chain via another widget
      keepTags.add(currentRef.tag);
      refByTag.set(currentRef.tag, currentRef);
      const node = pdfDocument.context.lookup(currentRef);
      if (!node || typeof node.get !== "function") return;
      currentRef = node.get(PDFName.of("Parent"));
      guard += 1;
    }
  }
  survivingWidgetRefs.forEach(markChain);

  // Step 3: for every marked non-terminal node, prune its /Kids to only the
  // marked ones (drop branches that only ever led to a removed page).
  const rootRefs = [];
  keepTags.forEach((tag) => {
    const ref = refByTag.get(tag);
    const node = pdfDocument.context.lookup(ref);
    if (!node || typeof node.get !== "function") return;
    const kids = node.get(PDFName.of("Kids"));
    if (kids && Array.isArray(kids.array)) {
      const prunedKids = PDFArray.withContext(pdfDocument.context);
      kids.array.forEach((kidRef) => {
        if (kidRef instanceof PDFRef && keepTags.has(kidRef.tag)) prunedKids.push(kidRef);
      });
      node.set(PDFName.of("Kids"), prunedKids);
    }
    if (!(node.get(PDFName.of("Parent")) instanceof PDFRef)) rootRefs.push(ref);
  });

  const fieldsArray = PDFArray.withContext(pdfDocument.context);
  rootRefs.forEach((ref) => fieldsArray.push(ref));
  acroForm.set(PDFName.of("Fields"), fieldsArray);

  return { rebuiltFieldCount: fieldsArray.size(), survivingWidgetCount: survivingWidgetRefs.length, markedNodeCount: keepTags.size };
}

module.exports = { rebuildAcroFormFieldsFromWidgets };
