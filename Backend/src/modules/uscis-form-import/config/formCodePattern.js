// Phase 7.2: ONE definition of "what a USCIS form code looks like", shared by the scanner, the on-demand importer and the catalog sync.
// Three different patterns used to live in three files and disagreed (I-9 and I-864EZ were never detected, I-129CWR was rejected by one and accepted by another).
//
//   shared:  [1-3 letters]-[2-4 digits][0-3 letters]   plus the one real single-digit form, I-9
//            -> I-9, I-90, I-129, I-129F, I-129CWR, I-864EZ, G-1145, AR-11, N-648, G-28I
//   never:   EOIR-29 (4 letters: not a USCIS form), H-1B / L-1 (a visa class, one digit), "A-1" style fragments
//
// Switch: with FORM_PIPELINE_AUTONOMY off the three LEGACY patterns are used exactly as before; shadow also keeps the legacy behavior (the callers log the difference);
// on uses the shared pattern. The mode is read when a pattern is asked for, never at load time.
const autonomy = require("../../../config/formPipelineAutonomy");

const SHARED_BODY = "(?:[A-Z]{1,3}-\\d{2,4}(?:SUP[A-Z]|[A-Z]{0,3})|I-9)"; // a supplement may be written glued with "sup": I-918SUPA, I-485SUPJ (the owner's rule: "sup" for forms with letters after the number)
const SUPPLEMENT = "(?:[\\s_-]+(?:SUPPLEMENT|SUPP\\.?|SUP\\.?)[\\s_-]+[A-Z])?"; // "I-485 Supplement A", "I-485 Supp. A" and "I-485 Sup A" are the same form

const LEGACY = Object.freeze({
  // USCISScannerService.FORM_CODE_PATTERN (global search inside text)
  scan: "\\b([A-Z]{1,3}-\\d{2,4}[A-Z]?(?:[\\s_-]+SUPPLEMENT[\\s_-]+[A-Z])?)\\b",
  // OnDemandFormAcquisitionService.STANDALONE_FORM_CODE_PATTERN
  importer: /^[A-Z]{1,3}-\d{2,4}[A-Z]{0,2}$/,
  // FormCatalogSyncService.STANDALONE
  sync: /^[A-Z]{1,3}-\d+[A-Z]?$/,
});
const SHARED_SCAN = `\\b(${SHARED_BODY}${SUPPLEMENT})\\b`;
const SHARED_STANDALONE = new RegExp(`^${SHARED_BODY}$`);
const EXPLICIT_IMPORT_ONLY = /^EOIR-\d{1,4}[A-Z]?$/;

/** A fresh global, case-insensitive search regex (callers use matchAll / exec loops, so it must not be shared state). */
function scanPattern(mode = autonomy.mode()) {
  return new RegExp(mode === "on" ? SHARED_SCAN : LEGACY.scan, "gi");
}

/**
 * Is this normalized code a standalone form? `legacyKind` picks which OLD pattern applies ("importer" | "sync"). Not on: the old pattern, exactly. On: the shared pattern OR the old
 * one - so switching on can only ADD forms (I-9, I-864EZ, I-129CWR ...), it never rejects a code that was accepted before.
 */
function isStandaloneFormCode(code, legacyKind = "importer", mode = autonomy.mode()) {
  const text = String(code || "");
  if (mode !== "on") return LEGACY[legacyKind].test(text);
  // A form a person (or the pipeline) asks for BY CODE may be a DOJ / EOIR form that uscis.gov hosts (EOIR-29: its own page and PDF). The text scan and the catalog sync still skip EOIR
  // codes - a mention in running text is not a catalog form - so this applies to the importer's explicit request only.
  if (legacyKind === "importer" && EXPLICIT_IMPORT_ONLY.test(text)) return true;
  return SHARED_STANDALONE.test(text) || LEGACY[legacyKind].test(text);
}

module.exports = { SHARED_BODY, SHARED_SCAN, SHARED_STANDALONE, LEGACY, scanPattern, isStandaloneFormCode };
