// Text Immiglance writes into the two DOL ETA-9089 forms must look like the text a person types into the same box.
//
// Every text box of those forms is "auto size" (/DA "/Helv 0 Tf"). A PDF viewer shows typed text in such a box at about 12 pt, but pdf-lib - which writes Immiglance's values - sizes an
// auto box to its whole HEIGHT, so the filled values came out noticeably larger than anything typed beside them (and a long employer name was clipped). This guard gives the auto boxes
// of THESE forms the form's own fixed size (externalForms.js `fontSizePt`) on the working copy, before the values' appearances are drawn; FullTextFieldGuard.shrinkLongTextToFit then
// shrinks only the entries that are too long for their box, as it does for every fixed-size box.
//
// It does nothing for any other form (the size is read from the form's entry in that data file, which only the two DOL forms have), leaves a box that already has a fixed size alone,
// and never throws: a failure leaves the box exactly as it was. The stored template PDF is never modified.
//
// HOOK: FullTextFieldGuard.shrinkLongTextToFit calls applyAutoFontSizeByBoxes() first - both renderers (PDFRenderer, AdobeFormRenderer) already call that function after the values are written and
// before their appearances are drawn, and it receives only the PDF, not the form code, so the form is recognised by its own boxes (the stems of its authored rules). PDFRenderer.js itself is
// deliberately NOT edited: the production server keeps a local change to that file, and any commit touching it makes the server's `git pull` (the deploy) abort.
const { externalFormFor } = require("../../uscis-form-import/config/externalForms");

const AUTO_SIZE = /\/\S+\s+0(?:\.0*)?\s+Tf/; // "/Helv 0 Tf" - font size 0 = auto
const isTextField = (field) => (field.constructor?.name || "").includes("TextField");

/** Returns how many boxes were set to the fixed size (0 for every other form). */
function applyAutoFontSize(form, formCode) {
  const size = Number(externalFormFor(formCode)?.fontSizePt);
  if (!Number.isFinite(size) || size <= 0) return 0;
  let changed = 0;
  let fields = [];
  try {
    fields = form.getFields();
  } catch (_error) {
    return 0;
  }
  for (const field of fields) {
    if (!isTextField(field)) continue;
    try {
      const appearance = field.acroField.getDefaultAppearance?.() || "";
      if (!AUTO_SIZE.test(appearance)) continue; // a box with its own fixed size keeps it
      field.setFontSize(size);
      changed += 1;
    } catch (_error) {
      // leave this box as it was
    }
  }
  return changed;
}

const stemOf = (name) => String(name || "").split(".").pop().replace(/\[\d+\]/g, "").toLowerCase();
const MIN_SHARE = 0.5; // at least half of the form's rule stems must be present (a box DOL renames in a later version does not stop the form being recognised)
const MIN_STEMS = 3;

/** Which DOL form this PDF is, from its boxes: the entry's form code, or null (every USCIS form, every unknown PDF). Pure of the database. */
function identifyExternalForm(form) {
  try {
    const { externalFormCodes } = require("../../uscis-form-import/config/externalForms");
    const { RULES } = require("../../form-mapping/config/partyFieldRules");
    const present = new Set(form.getFields().map((field) => stemOf(field.getName())));
    let best = null;
    for (const code of externalFormCodes()) {
      const stems = [...new Set((RULES[code] || []).flatMap((rule) => rule.stems).map((stem) => String(stem).toLowerCase()))];
      if (stems.length < MIN_STEMS) continue;
      const share = stems.filter((stem) => present.has(stem)).length / stems.length;
      if (share >= MIN_SHARE && (!best || share > best.share)) best = { code, share };
    }
    return best ? best.code : null;
  } catch (_error) {
    return null;
  }
}

/** applyAutoFontSize for whichever DOL form this PDF is (0 for any other PDF). The entry point FullTextFieldGuard calls. */
function applyAutoFontSizeByBoxes(form) {
  const code = identifyExternalForm(form);
  return code ? applyAutoFontSize(form, code) : 0;
}

module.exports = { applyAutoFontSize, applyAutoFontSizeByBoxes, identifyExternalForm, AUTO_SIZE };
