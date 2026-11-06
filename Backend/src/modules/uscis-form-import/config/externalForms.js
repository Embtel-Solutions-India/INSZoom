// Forms the pipeline fetches from an OFFICIAL source that is not uscis.gov - kept as DATA, one entry per form, so adding or correcting one needs no code change.
//
// Today exactly two, both published by the U.S. Department of Labor (OFLC) on https://www.dol.gov/agencies/eta/foreign-labor/forms :
//   ETA-9089A   "Form ETA-9089, Appendix A"          (Foreign Worker Information)
//   ETA-9089FD  "Form ETA-9089, Final Determination"
// Nothing else on dol.gov is ever discovered or fetched: the allow-list below IS the list. The similar "Appendix A - 508 Compliant - 06.01.2023" file (Professional Athletes) and every other
// ETA form are deliberately not here.
//
// These PDFs print NO edition date (only an OMB approval/expiration date, which is not a version). Their version is therefore decided by CONTENT (see ExternalFormFingerprint.js): the first
// import is "v1"; a later official file whose text / fields / page count differ becomes "v2", and so on. The OMB expiration date is stored as information only and is never compared.
//
// The official file name carries the OMB expiry ("ETA-9089-AppendixA-Expires02-28-29.pdf") and will change when DOL renews the form, so the address is never trusted as fixed: the forms page
// is scanned for a link whose FILE NAME starts with `filePrefix`.

const HOST = "www.dol.gov";
const FORMS_PAGE = "https://www.dol.gov/agencies/eta/foreign-labor/forms";
const FILES_DIR = "/sites/dolgov/files/ETA/oflc/pdfs/";

const ENTRIES = Object.freeze({
  "ETA-9089A": Object.freeze({
    formCode: "ETA-9089A",
    provider: "dol",
    title: "Form ETA-9089, Appendix A",
    internalLabel: "ETA-9089-APPENDIX-A",
    host: HOST,
    pageUrl: FORMS_PAGE,
    knownPdfUrl: `https://${HOST}${FILES_DIR}ETA-9089-AppendixA-Expires02-28-29.pdf`,
    // the file name must START with this (case-insensitive): it separates the form from the "Form%20ETA-9089%20-%20Appendix%20A%20-%20508..." Professional Athletes file
    filePrefix: /^ETA-9089-AppendixA-/i,
    linkText: /^Form ETA-9089,?\s+Appendix A$/i,
    // what the page footers print: "Form ETA-9089 - Appendix A ... Page A.1 of A.5"
    identity: { is: /Appendix\s*A/i, isNot: /Final\s*Determination/i },
    // Every box of this form is "auto size" (/Helv 0 Tf): a viewer shows typed text at about 12 pt, but our PDF writer would fill the whole box height (noticeably larger). The text Immiglance
    // writes uses this size instead, so it matches what a person types in the same box (form-generation/services/AutoFontSizeGuard.js). Only these two forms have it.
    fontSizePt: 12,
    // box names the generic name-based type guess misreads: "...that ISSUED the degree" is an institution name (not a date) and "apartment suite floor and NUMBER" can hold letters ("4B")
    fieldTypeOverrides: Object.freeze([
      { match: /Name of Institution that issued the degree/i, type: "text" },
      { match: /Address 2 apartmentsuitefloor and number/i, type: "text" },
    ]),
  }),
  "ETA-9089FD": Object.freeze({
    formCode: "ETA-9089FD",
    provider: "dol",
    title: "Form ETA-9089, Final Determination",
    internalLabel: "ETA-9089-FINAL-DETERMINATION",
    host: HOST,
    pageUrl: FORMS_PAGE,
    knownPdfUrl: `https://${HOST}${FILES_DIR}ETA-9089-Final-Determination-Expires02-28-29.pdf`,
    filePrefix: /^ETA-9089-Final-Determination-/i,
    linkText: /^Form ETA-9089,?\s+Final Determination$/i,
    identity: { is: /Final\s*Determination/i, isNot: /Appendix\s*A/i },
    fontSizePt: 12, // see ETA-9089A above
  }),
});

const normalize = (code) => String(code || "").trim().toUpperCase().replace(/\s+/g, "");

/** The entry for a form code, or null for every other form (all USCIS forms). Pure; the ONLY switch the shared pipeline code asks. */
function externalFormFor(formCode) {
  return ENTRIES[normalize(formCode)] || null;
}
const isExternalFormCode = (formCode) => Boolean(externalFormFor(formCode));
const externalFormCodes = () => Object.keys(ENTRIES);

/** The file name of a url without query / extension, for matching against `filePrefix`. */
const fileNameOf = (url) => {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop() || "").replace(/\.pdf$/i, ""); } catch { return ""; }
};

module.exports = { ENTRIES, HOST, FORMS_PAGE, FILES_DIR, externalFormFor, isExternalFormCode, externalFormCodes, fileNameOf };
