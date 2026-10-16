// Plan Rule D: THE one automatic-acceptance predicate, FilingEligibilityStatement(edition). Pure: it reads the text of an official uscis.gov form page
// (the system's own snapshot) and says whether that page EXPLICITLY states filing eligibility for ONE specific edition.
//
// Release 0b-2: enabled on the user's explicit instruction (2026-10-16: "fully automatic acceptance"). First only for explicit statements; then the user
// decided that the edition USCIS publishes as current (found by the 12-hourly edition-date check) needs no explicit sentence: it is accepted unless the page
// refuses it. An OLDER edition (not the one the page lists) with no statement still returns "none" and stays held. Patterns were validated against real
// page text (fixtures in tests/fixtures/uscisPages.json, fetched from uscis.gov).
//
// Statements recognised (each quoted verbatim from the page, so the verifier can prove the quote is really in the snapshot):
//   current_acceptable_edition - USCIS's own sentence "[You can find|can be found] the current acceptable edition under the Edition Date section ..."
//                                AND the page's own "Edition Date <D>" equals this edition  -> accepted
//   current_official_edition   - (user decision 2026-10-16) the page's own "Edition Date <D>" equals this edition and NO sentence names it as refused -> accepted
//   explicit_accept            - "USCIS continues to accept / will accept / will only accept / may continue using the <D> edition [of Form X]" -> accepted
//   explicit_not_accept        - "is not accepting / will not accept / no longer accepts / cannot accept the <D> edition [of Form X]" -> not_accepted
// An edition named by BOTH an accepting and a not-accepting statement (or contradicting the page's own current edition) is ambiguous -> "none".
// A date attached to another form ("08/21/25 edition of Form I-765" on the I-539 page) never counts for this form.
// "Reject" / "will not process" count as refusals, so an edition USCIS accepts only until a date and then refuses (I-129's 02/27/26, I-864's 10/17/24)
// is named by both kinds of statement and is ambiguous -> held.

const { collapseWhitespace } = require("./htmlText");

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");

/** "09/17/18" | "9/17/2018" -> "2018-09-17" (two-digit years are 20yy), or null. */
function numericDateToIso(token) {
  const m = String(token || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** "Oct. 1, 2026" | "November 9, 2026" -> "2026-10-01", or null. */
function longDateToIso(text) {
  const m = String(text || "").match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),\s+(\d{4})\b/i);
  if (!m) return null;
  return `${m[3]}-${pad(MONTHS[m[1].toLowerCase()])}-${pad(Number(m[2]))}`;
}

// Sentences of the (whitespace-collapsed) text, as slices of the ORIGINAL so every quote is verbatim. Month abbreviations ("Oct. 1") are masked
// only while looking for sentence ends.
function sentencesOf(collapsed) {
  const masked = collapsed.replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec|No|Nos|Inc|Dr|St)\./g, (m) => `${m.slice(0, -1)}\u0001`);
  const out = [];
  let start = 0;
  const re = /[.!?](?=\s+[A-Z0-9“"(])/g;
  let match;
  while ((match = re.exec(masked))) {
    out.push(collapsed.slice(start, match.index + 1).trim());
    start = match.index + 1;
  }
  out.push(collapsed.slice(start).trim());
  return out.filter(Boolean);
}

/** The edition the PAGE itself lists under "Form Details / Edition Date": one distinct date, or null when absent or ambiguous. */
function pageEditionDate(collapsed) {
  const dates = new Set([...collapsed.matchAll(/Edition Date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/g)].map((m) => numericDateToIso(m[1])).filter(Boolean));
  return dates.size === 1 ? [...dates][0] : null;
}

/** A verbatim slice of the page around its own "Edition Date <D>" for this edition (the quote kept in the audit trail). */
function currentEditionQuote(collapsed, editionIdentifier) {
  for (const match of collapsed.matchAll(/Edition Date\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/g)) {
    if (numericDateToIso(match[1]) !== editionIdentifier) continue;
    return collapsed.slice(Math.max(0, match.index - 40), match.index + match[0].length + 25).trim();
  }
  return null;
}

const CURRENT_ACCEPTABLE = /(?:The current acceptable edition can be found|You can find the current acceptable edition) under the Edition Date section[^.]{0,60}?webpage\.?/;
const NEGATIVE_CUE = /\b(?:is|are) not accepting\b|\bwill not (?:accept|process)\b|\bdoes not accept\b|\bno longer accepts?\b|\bcannot accept\b|\breject(?:s|ed)?\b/i;
const POSITIVE_CUE = /\bcontinues? to accept\b|\bwill (?:also |only )?accept\b|\baccepts?\b|\b(?:may|can) continue using\b/i;
const DATE = "\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}";
// "08/28/24 edition", "09/17/18 and 05/23/18 editions", optionally followed by "of Form(s) I-539 [and I-765]"
const EDITION_REFERENCE = new RegExp(`(${DATE}(?:\\s*(?:,|and)\\s*${DATE})*)\\s+editions?(?:\\s+of\\s+Forms?\\s+([A-Z]{1,2}-\\d+[A-Z]*(?:(?:,|\\s+and|\\s+or)\\s+[A-Z]{1,2}-\\d+[A-Z]*)*))?`, "gi");
const FORM_CODE = /\b[A-Z]{1,2}-\d+[A-Z]*\b/g;
const normalizeForm = (code) => String(code || "").toUpperCase().replace(/\s+/g, "");

function clausesOf(sentence) {
  return sentence.split(/\s+(?:and|but)\s+(?=(?:is|are|will|does|do|cannot|no longer)\b)|;\s+/i);
}

/** All { kind, pattern, quote, edition, dates } an explicit sentence says about editions of THIS form. */
function explicitStatements(sentence, formCode) {
  const found = [];
  const form = normalizeForm(formCode);
  for (const clause of clausesOf(sentence)) {
    const kind = NEGATIVE_CUE.test(clause) ? "not_accepted" : POSITIVE_CUE.test(clause) ? "accepted" : null;
    if (!kind) continue;
    const otherForms = new Set((clause.match(FORM_CODE) || []).map(normalizeForm));
    for (const reference of clause.matchAll(EDITION_REFERENCE)) {
      const named = reference[2] ? new Set(reference[2].match(FORM_CODE).map(normalizeForm)) : null;
      // a date attributed to other forms never counts for this one; with no form named it belongs to the page's own form only if no other form is mentioned
      const applies = named ? named.has(form) : [...otherForms].every((code) => code === form);
      if (!applies) continue;
      const rejection = kind === "not_accepted" ? /\b(?:on or after|after)\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},\s+\d{4})/i.exec(sentence) : null;
      for (const token of reference[1].match(new RegExp(DATE, "g"))) {
        found.push({
          kind, pattern: kind === "accepted" ? "explicit_accept" : "explicit_not_accept", quote: sentence, edition: numericDateToIso(token),
          // "Starting <date>, we will accept ONLY the X edition" marks when OLDER editions stop being accepted - X itself is usable now - so a date
          // like that is never read as X's effective date (it would wrongly hold an edition that is already usable)
          dates: { effectiveDate: null, rejectionDate: rejection ? longDateToIso(rejection[1]) : null, graceUntil: null },
        });
      }
    }
  }
  return found;
}

/**
 * FilingEligibilityStatement(edition): { verdict: "accepted" | "not_accepted" | "none", pattern, quote, dates, evidence[], ambiguous }
 * `none` means "no explicit statement about this edition" (or contradictory statements): the edition stays held.
 */
function filingEligibilityStatement({ text, formCode, editionIdentifier }) {
  const none = (extra = {}) => ({ verdict: "none", pattern: null, quote: null, dates: { effectiveDate: null, rejectionDate: null, graceUntil: null }, evidence: [], ambiguous: false, ...extra });
  if (!text || !formCode || !/^\d{4}-\d{2}-\d{2}$/.test(String(editionIdentifier || ""))) return none();
  const collapsed = collapseWhitespace(text);
  const statements = [];

  const current = collapsed.match(CURRENT_ACCEPTABLE);
  const pageEdition = pageEditionDate(collapsed);
  if (current && pageEdition === editionIdentifier) {
    statements.push({ kind: "accepted", pattern: "current_acceptable_edition", quote: current[0], edition: editionIdentifier, dates: { effectiveDate: null, rejectionDate: null, graceUntil: null } });
  }
  for (const sentence of sentencesOf(collapsed)) {
    if (sentence.length > 700) continue; // page furniture, not a statement
    for (const statement of explicitStatements(sentence, formCode)) if (statement.edition === editionIdentifier) statements.push(statement);
  }
  if (!statements.length) {
    // The user's decision (2026-10-16): the edition USCIS itself publishes as current IS the accepted one unless USCIS says otherwise. The 12-hourly catalog
    // sync keeps the installed edition equal to the published one, so "the page lists exactly this edition under Edition Date" and "no sentence refuses it"
    // is enough here; the verifier still has to prove the rest (official source, the page names the edition, the stored PDF is the official PDF).
    const published = pageEdition === editionIdentifier ? currentEditionQuote(collapsed, editionIdentifier) : null;
    if (!published) return none();
    return { verdict: "accepted", pattern: "current_official_edition", quote: published, dates: { effectiveDate: null, rejectionDate: null, graceUntil: null }, evidence: [], ambiguous: false };
  }

  const accepted = statements.filter((statement) => statement.kind === "accepted");
  const rejected = statements.filter((statement) => statement.kind === "not_accepted");
  // contradictory statements (or an edition the page itself lists as current but another sentence refuses) are never decided by a machine
  if (accepted.length && rejected.length) return none({ evidence: statements, ambiguous: true });
  const chosen = rejected.length ? rejected[0] : (accepted.find((statement) => statement.pattern === "explicit_accept") || accepted[0]);
  return { verdict: chosen.kind, pattern: chosen.pattern, quote: chosen.quote, dates: chosen.dates, evidence: statements, ambiguous: false };
}

const compactCode = (value) => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * The form whose uscis.gov page governs a supplement that has no page of its own: "I-539A" -> "I-539", "I-485J" -> "I-485", "I-918SUPA" and
 * "I-918 SUPPLEMENT A" -> "I-918". null when the code does not look like a supplement.
 */
function parentFormCodeOf(formCode) {
  const code = String(formCode || "").trim().toUpperCase();
  const named = code.match(/^([A-Z]{1,3}-\d+)\s*SUPP?(?:LEMENT)?\s*[A-Z]+$/);
  if (named) return named[1];
  const lettered = code.match(/^([A-Z]{1,3}-\d+)[A-Z]$/);
  return lettered ? lettered[1] : null;
}

/** Does the page itself list this supplement ("Form I-539A (PDF)", "Form I-918, Supplement A")? Spacing and punctuation are ignored. */
function pageMentionsForm(text, formCode) {
  const page = compactCode(text);
  const code = compactCode(formCode);
  const named = String(formCode || "").toUpperCase().match(/^([A-Z]{1,3}-\d+)\s*SUPP?(?:LEMENT)?\s*([A-Z]+)$/);
  const tokens = new Set([code]);
  if (named) { tokens.add(compactCode(`${named[1]}SUP${named[2]}`)); tokens.add(compactCode(`${named[1]}SUPPLEMENT${named[2]}`)); }
  return [...tokens].some((token) => token && page.includes(token));
}

module.exports = { parentFormCodeOf, pageMentionsForm, filingEligibilityStatement, pageEditionDate, sentencesOf, numericDateToIso, longDateToIso, explicitStatements };
