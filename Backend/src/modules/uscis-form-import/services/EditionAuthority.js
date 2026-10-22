// Phase 7.2: which edition date does the system believe, and which PDF is "the form"? Pure functions, no database, no network.
//
// decide(): authority order  page "Edition Date"  >  the edition printed in the PDF footer  >  the directory listing.
//   - a date more than a day in the future is rejected (a page that announces an upcoming edition is not the edition in force)
//   - a date OLDER than the installed edition is "older, not new" (USCIS pages sometimes keep mentioning the previous edition)
//   - disagreeing sources are reported as conflicts; the highest-authority valid source still decides
// choosePdf(): the PDF that is the FORM itself, never its instructions, a checklist or a translation.
const DAY_MS = 86400000;

const toDate = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};
const isoDay = (date) => date.toISOString().slice(0, 10);

const SOURCES = ["page", "pdf_footer", "directory"];

/**
 * @returns {{ editionDate: Date|null, source: string|null, status: "new"|"same"|"older"|"unknown"|"none", conflicts: Array<{source,date,reason}> }}
 *   status: new = later than the installed edition (or nothing installed); same = same day; older = earlier than installed; unknown = a date exists but nothing installed to compare; none = no usable date
 */
function decide({ pageEditionDate, pdfFooterEdition, directoryDate, storedEditionDate, now = new Date() } = {}) {
  const limit = new Date(toDate(now).getTime() + DAY_MS);
  const raw = { page: toDate(pageEditionDate), pdf_footer: toDate(pdfFooterEdition), directory: toDate(directoryDate) };
  const conflicts = [];
  const valid = [];
  for (const source of SOURCES) {
    const date = raw[source];
    if (!date) continue;
    if (date.getTime() > limit.getTime()) { conflicts.push({ source, date: isoDay(date), reason: "future" }); continue; }
    valid.push({ source, date });
  }
  if (!valid.length) return { editionDate: null, source: null, status: "none", conflicts };
  const chosen = valid[0];
  for (const other of valid.slice(1)) {
    if (isoDay(other.date) !== isoDay(chosen.date)) conflicts.push({ source: other.source, date: isoDay(other.date), reason: "disagrees" });
  }
  const stored = toDate(storedEditionDate);
  let status = "unknown";
  if (stored) status = isoDay(chosen.date) === isoDay(stored) ? "same" : chosen.date.getTime() > stored.getTime() ? "new" : "older";
  else if (storedEditionDate === null) status = "new"; // explicitly nothing installed
  return { editionDate: chosen.date, source: chosen.source, status, conflicts };
}

// ---- which PDF link is the form ---------------------------------------------------------------------------------------------------------------------------------------
const baseName = (url) => String(url || "").split(/[?#]/)[0].split("/").pop().replace(/\.pdf$/i, "").toLowerCase();

/**
 * True for an instructions / guide PDF. Judged by the FILE NAME first (i-539instr.pdf, i-129h2ainstr.pdf, i-485supjinstr.pdf, i-9instr.pdf) and by link text that STARTS with
 * "Instructions for" - not by the word appearing anywhere (the real I-9 page labels the form itself "Form I-9 (Please see the Download Instructions tab ...)").
 */
function isInstructionsPdf({ url, text } = {}) {
  const name = baseName(url);
  if (/(?:instr|instructions?)$/.test(name) || /-instructions?(?:-|$)/.test(name) || /(?:^|[-_])ins(?:[-_]|$)/.test(name)) return true;
  return /^\s*(?:download\s+)?(?:the\s+)?instructions?\b/i.test(String(text || "")) || /\binstructions\s+for\b/i.test(String(text || "").slice(0, 40));
}

const alnum = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A regex for link text that STARTS with this form code and has a real boundary after it (so "I-129" never matches "I-129H2A" or "I-1290"). The text must START with the form
 * ("Form I-129 (PDF, 2.9 MB)"): a checklist that merely MENTIONS it ("Optional Checklist for Form I-129 H-1B Filings") is not the form.
 */
function codeRegex(formCode) {
  const code = String(formCode || "").toUpperCase().trim();
  const supplement = code.match(/^([A-Z]{1,3})-?(\d{2,4})\s*(?:SUPPLEMENT|SUP)[\s_-]*([A-Z])$/);
  const body = supplement ? `${supplement[1]}-?${supplement[2]}[\\s,_-]*(?:SUPPLEMENT|SUP)[\\s_-]*${supplement[3]}` : escapeRe(code).replace(/-/g, "-?");
  return new RegExp(`^\\s*(?:(?:download|view)\\s+)?(?:form\\s+)?${body}(?![A-Za-z0-9])`, "i");
}

/** True when the link's FILE NAME is this form (i-539.pdf, i-485supj.pdf; extra file-name slugs come from the alias data). */
function nameIsForm({ url } = {}, formCode, aliasSlugs = []) {
  const code = alnum(String(formCode || "").replace(/\s*SUPPLEMENT\s*/i, "SUP"));
  const name = alnum(baseName(url));
  return Boolean(code && name === code) || aliasSlugs.some((slug) => alnum(slug) === name);
}

/** True when the link TEXT starts with this form code. */
function textIsForm({ text } = {}, formCode) {
  return Boolean(formCode) && codeRegex(formCode).test(String(text || ""));
}

/** True when the file name or the start of the link text names this form code. */
function namesForm(anchor = {}, formCode, aliasSlugs = []) {
  return nameIsForm(anchor, formCode, aliasSlugs) || textIsForm(anchor, formCode);
}

/**
 * The form's own PDF among the page's anchors: not instructions, not off-site, and its file name or text names the form; the first such link wins.
 * Falls back to the first non-instructions PDF only when `allowFirstResort` (the old behavior), so a page that names no form is never silently wrong when it is not allowed.
 */
function choosePdf(anchors = [], formCode, { aliasSlugs = [], allowFirstResort = false } = {}) {
  const pdfs = anchors.filter((anchor) => /\.pdf(?:$|[?#])/i.test(anchor.url) && /(?:^|\.)uscis\.gov$/i.test(safeHost(anchor.url)));
  const forms = pdfs.filter((anchor) => !isInstructionsPdf(anchor));
  return forms.find((anchor) => nameIsForm(anchor, formCode, aliasSlugs)) || forms.find((anchor) => textIsForm(anchor, formCode)) || (allowFirstResort ? forms[0] : null) || null;
}

function safeHost(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

module.exports = { decide, isInstructionsPdf, namesForm, nameIsForm, textIsForm, choosePdf, toDate, isoDay, SOURCES };
