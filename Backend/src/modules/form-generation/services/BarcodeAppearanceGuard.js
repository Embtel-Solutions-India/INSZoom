// ISSUE-003 follow-up: ProtectedFieldPolicy stops this app from ever WRITING
// to a barcode field, which keeps that field's own /AP /N image-XObject
// appearance byte-identical to the template (verified in
// ProtectedFieldPolicy.test.js). That turned out not to be sufficient on its
// own: both render engines' OUTPUT documents come back with the AcroForm's
// /NeedAppearances flag set true -
//   - PDFRenderer.js sets it explicitly and intentionally, so viewers that
//     don't trust pdf-lib's own generated text-field appearances rebuild them
//     (a real, previously-verified requirement - see PDFRenderer.js's own
//     comment and h3-pdf-render.test.js's "editable render must set
//     NeedAppearances" assertion).
//   - Adobe's setformdata operation independently returns its output with
//     the same flag set (confirmed empirically against a real production
//     download's stored bytes - not assumed).
// /NeedAppearances is a single, document-wide AcroForm flag with no per-field
// opt-out in the PDF spec: a compliant viewer that honors it discards EVERY
// widget's stored appearance and rebuilds it from the field's /V value using
// its /DA default appearance (a font) - including an untouched, correctly
// image-backed barcode field, which is exactly why the barcode field's own
// payload string (e.g. "I-129|02/27/26|1") was visibly rendering as plain
// text even though the underlying PDF bytes were provably correct at the
// object level (image XObject present, byte-identical to the template).
//
// Fix: convert each barcode field's CURRENT (untouched, correct) appearance
// into static page content and remove the field/widget entirely, using the
// same technique pdf-lib's own PDFForm.flatten() uses internally (this pdf-
// lib version's flatten() has no per-field selector, only "flatten
// everything" - see node_modules/pdf-lib/cjs/api/form/PDFForm.js's own
// flatten()/removeField()/findWidgetPage()/findWidgetAppearanceRef(), all of
// which are public instance methods this reuses rather than duplicates).
// Once a barcode field is baked into the page and no longer exists as a
// widget annotation, /NeedAppearances has nothing left to rebuild for it -
// the graphic is permanently immune to it, on every viewer, regardless of
// which engine (pdf-lib or Adobe) produced the document.
//
// Deliberately scoped narrower than ProtectedFieldPolicy.isProtectedField():
// only fields that are BOTH protected AND currently have a real /Image
// XObject appearance are flattened. A protected-but-empty signature field
// (no /V, so nothing for NeedAppearances to misrender as text in the first
// place - this is a theoretical risk noted in ISSUES.md, never an observed
// bug) is left as a live, interactive widget, since flattening it would
// permanently remove the ability for anyone to click-to-sign it later - a
// real regression this fix does not need to risk to solve the reported bug.
const { PDFName, PDFRef, PDFRawStream, PDFDict, pushGraphicsState, popGraphicsState, translate, drawObject, rotateInPlace } = require("pdf-lib");
const { isProtectedField } = require("./ProtectedFieldPolicy");

function hasImageAppearance(field) {
  for (const widget of field.acroField.getWidgets()) {
    const apDict = widget.dict.get(PDFName.of("AP"));
    if (!apDict || !(apDict instanceof PDFDict)) continue;
    const normal = apDict.get(PDFName.of("N"));
    const stream = normal instanceof PDFRef ? widget.doc?.context?.lookup(normal) : normal;
    // widget.dict.context is always available; widget.doc is not on every
    // pdf-lib version, so resolve refs via the dict's own context instead.
    const resolved = normal instanceof PDFRef ? widget.dict.context.lookup(normal) : normal;
    const candidate = resolved instanceof PDFRawStream ? resolved : stream;
    if (!(candidate instanceof PDFRawStream)) continue;
    const resources = candidate.dict.get(PDFName.of("Resources"));
    const resourcesDict = resources instanceof PDFRef ? candidate.dict.context.lookup(resources) : resources;
    if (!resourcesDict || !(resourcesDict instanceof PDFDict)) continue;
    const xObjectDict = resourcesDict.get(PDFName.of("XObject"));
    const xObjects = xObjectDict instanceof PDFRef ? resourcesDict.context.lookup(xObjectDict) : xObjectDict;
    if (xObjects instanceof PDFDict && [...xObjects.keys()].length > 0) return true;
  }
  return false;
}

// Mirrors PDFForm.prototype.flatten()'s per-field body exactly (see the
// header comment above), scoped to one field instead of "all fields."
function flattenField(form, field) {
  const widgets = field.acroField.getWidgets();
  for (const widget of widgets) {
    const page = form.findWidgetPage(widget);
    const widgetRef = form.findWidgetAppearanceRef(field, widget);
    const xObjectKey = page.node.newXObject("FlatWidget", widgetRef);
    const rectangle = widget.getRectangle();
    const operators = [
      pushGraphicsState(),
      translate(rectangle.x, rectangle.y),
      ...rotateInPlace({ ...rectangle, rotation: 0 }),
      drawObject(xObjectKey),
      popGraphicsState(),
    ].filter(Boolean);
    page.pushOperators(...operators);
  }
  form.removeField(field);
}

// Call after all data fields have been written (setFormField/setformdata)
// but before flatten()/NeedAppearances is decided - removing these fields
// first means neither the top-level `flatten()` call nor the
// `NeedAppearances` flag can ever touch them again, on either engine.
// Returns the list of flattened field names, for renderReport auditability.
function flattenBarcodeAppearances(form, formCode) {
  const flattened = [];
  for (const field of form.getFields()) {
    const name = field.getName();
    if (!isProtectedField(name, formCode)) continue;
    if (!hasImageAppearance(field)) continue;
    flattenField(form, field);
    flattened.push(name);
  }
  return flattened;
}

module.exports = { flattenBarcodeAppearances, hasImageAppearance };
