// "Is this PDF really the form we asked for?" - the check that was missing between download and storage. The importer used to trust the form code of the REQUEST, so when a
// wrong file came back (the EOIR-29 PDF was stored as AR-11, G-28, I-130 and I-360; the I-485 Supplement J file as I-140 and I-508), it was stored, mapped, certified (a PDF with
// fields certifies fine) and could have gone live as the wrong form.
//
// Every USCIS form prints its own number in the page footer ("Form I-130 Edition 04/01/24", "Form I-918 Supplement A Edition ..."). This service reads those footers from the PDF's
// text layer (pdfjs-dist) and compares the number with the requested form. It refuses ONLY on a clear contradiction - a dominant footer number that is a different form - and stays
// out of the way (inconclusive -> import proceeds) when a PDF prints no footer number. Any internal error is also "inconclusive": this guard must never block a good form.
const FOOTER_ZONE_PT = 75; // the bottom (and top) strip of a page where the footer lives
const MAX_PAGES = 8;
// "Form I-485 Supplement J", "Form I-485 Supp. J" and "Form I-485 Sup J" are all printed by USCIS
const FORM_NUMBER = /Form\s+([A-Za-z]{1,5}-\d+[A-Za-z]{0,3})(?:\s+(?:Supplement|Supp\.?|Sup\.?)\s+([A-Za-z0-9/]+))?/gi;

/** Pure. "I-485 Supplement J", "I-485SUPPLEMENT J", "I-485J" -> "I-485J"; "I-918SUPA" -> "I-918A"; "G-28" -> "G-28". Upper-case, no spaces, "supplement" folded into the suffix letter. */
function normalizeFormNumber(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, "").replace(/SUPPLEMENT|SUPP\.?|SUP(?=[A-Z0-9])/g, "");
}

/** Pure. Every form number printed in the given footer texts, normalized, with how many times each appears. */
function footerNumbers(texts = []) {
  const counts = new Map();
  for (const text of texts) {
    for (const match of String(text).matchAll(FORM_NUMBER)) {
      const code = normalizeFormNumber(`${match[1]}${match[2] ? ` SUPPLEMENT ${match[2]}` : ""}`);
      counts.set(code, (counts.get(code) || 0) + 1);
    }
  }
  return counts;
}

/**
 * Pure. { ok: true } unless the footers clearly name another form. `counts` is footerNumbers(); `requested` is the form code asked for. The request is compatible when ANY footer
 * number equals it (a bundle PDF may print its parent's number too). A single stray footer is not enough: the contradicting number must be printed at least twice, or be the only one.
 */
function judge(counts, requested) {
  const wanted = normalizeFormNumber(requested);
  if (!counts.size || !wanted) return { ok: true, inconclusive: true };
  if (counts.has(wanted)) return { ok: true };
  const [dominant, times] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (times < 2 && counts.size > 1) return { ok: true, inconclusive: true };
  return { ok: false, found: dominant, requested: wanted, times };
}

async function footerTexts(buffer) {
  const pdfjs = await require("../../../utils/pdfjsShared").loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const out = [];
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(doc.numPages, MAX_PAGES); pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const [, , , top] = page.view;
      const content = await page.getTextContent();
      const strip = content.items.filter((item) => item.str && item.str.trim() && (item.transform[5] <= FOOTER_ZONE_PT || item.transform[5] >= top - FOOTER_ZONE_PT));
      out.push(strip.map((item) => item.str.trim()).join(" "));
    }
  } finally {
    await Promise.resolve(task.destroy?.()).catch(() => null);
  }
  return out;
}

// "Edition 09/04/26" / "Edition 12/12/2024" printed in the footer
const FOOTER_EDITION = /Edition\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/gi;

/** Pure. The edition date the footers print most often, as an ISO day ("2026-09-04"), or null. */
function footerEditionOf(texts = []) {
  const counts = new Map();
  for (const text of texts) {
    for (const match of String(text).matchAll(FOOTER_EDITION)) {
      const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
      const month = Number(match[1]);
      const day = Number(match[2]);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      counts.set(iso, (counts.get(iso) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/** The edition date printed in a PDF's own footers (ISO day) or null. Never throws. */
async function footerEdition(buffer) {
  try {
    return footerEditionOf(await footerTexts(buffer));
  } catch (_error) {
    return null;
  }
}

/** { ok, found?, requested?, inconclusive? } for a PDF buffer. Never throws. */
async function check(buffer, requestedFormCode) {
  try {
    return judge(footerNumbers(await footerTexts(buffer)), requestedFormCode);
  } catch (_error) {
    return { ok: true, inconclusive: true };
  }
}

/** Throws FORM_PDF_MISMATCH (422, permanent) when the PDF is clearly another form; otherwise returns the result. */
async function assertMatches(buffer, requestedFormCode) {
  const result = await check(buffer, requestedFormCode);
  if (!result.ok) {
    const error = new Error(`The downloaded PDF is Form ${result.found}, not ${result.requested} - it was not stored`);
    error.status = 422;
    error.statusCode = 422;
    error.code = "FORM_PDF_MISMATCH";
    throw error;
  }
  return result;
}

module.exports = { check, assertMatches, judge, footerNumbers, normalizeFormNumber, footerEdition, footerEditionOf };
