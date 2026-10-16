// Plan Rule D: what the SYSTEM can verify about an evidence claim. Pure: it is handed the snapshot the system fetched and the artifacts it holds.
//
// AUTOMATIC here = source authenticity (official host, https, validated redirects), freshness, that the reviewer's verbatim quote is really in the
// system's own snapshot text, that the specific edition is named in it, consistency with the template / PDF, and that claimed dates match the
// quote. A matching quote proves only that the text EXISTS in the official snapshot - never that the legal conclusion drawn from it is right.
// That conclusion stays with the admin / team lead, who must confirm it explicitly (EvidenceService.recordDecision).
//
// Outcome: "verified" (every blocking check passed), "conflicting" (the claim disagrees with the page / PDF / template or its own dates) or
// "unverifiable" (the source could not be read, or the quote / edition is not in it). Conflicting wins when both apply.

const { checkUrl } = require("./officialUrl");
const { collapseWhitespace } = require("./htmlText");
const { FRESHNESS_WINDOW_MS, VERIFICATION_RESULTS } = require("./editionPolicy.constants");

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** "2025-01-20" -> the ways USCIS pages write that date. */
function dateVariants(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];
  const [, year, month, day] = match;
  const m = String(Number(month));
  const d = String(Number(day));
  const monthName = MONTHS[Number(month) - 1];
  if (!monthName) return [];
  const yy = year.slice(2);
  return [
    `${month}/${day}/${yy}`, `${month}/${day}/${year}`, `${m}/${d}/${yy}`, `${m}/${d}/${year}`, `${year}-${month}-${day}`,
    `${monthName} ${d}, ${year}`, `${monthName.slice(0, 3)}. ${d}, ${year}`, `${monthName.slice(0, 3)} ${d}, ${year}`, `${d} ${monthName} ${year}`,
  ];
}

/** Does `text` contain this ISO date in any of its usual written forms? Numeric forms may not be part of a longer number / date. */
function containsDate(text, iso) {
  const haystack = String(text || "");
  return dateVariants(iso).some((variant) => {
    const numeric = /^[\d/-]+$/.test(variant);
    const pattern = numeric ? new RegExp(`(?<![\\d/-])${escapeRegExp(variant)}(?![\\d/])`) : new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(variant)}(?![A-Za-z0-9])`, "i");
    return pattern.test(haystack);
  });
}

const check = (name, passed, { category, severity = "blocking", detail }) => ({ name, passed: Boolean(passed), category, severity, detail });

/**
 * submission: { formCode, editionIdentifier (YYYY-MM-DD), quote, claimedDates: { effectiveDate, rejectionDate, graceUntil } (ISO or null) }
 * snapshot:   { finalUrl, redirectChain: [{url}], fetchedAt, extractedText } | null (the fetch failed)
 * artifact:   { template: bool, editionDate, editionDateSource, publishedEditionDate, pdfChecksumStored, pdfChecksumFetched, pdfPrintedEdition } | null
 *             pdfPrintedEdition = the edition printed in the footer of the STORED pdf (ISO) or null; it stands in for the checksum comparison only when that
 *             comparison is impossible (no stored checksum / no official pdf to download) - a checksum that was compared and differs always fails.
 */
function verifyEvidence({ submission, snapshot, artifact, now = new Date() }) {
  const checks = [];
  const U = VERIFICATION_RESULTS.UNVERIFIABLE;
  const C = VERIFICATION_RESULTS.CONFLICTING;

  if (!snapshot) {
    checks.push(check("source_fetched", false, { category: U, detail: "the official source could not be fetched and read, so nothing can be verified" }));
    return summarize(checks);
  }
  const text = String(snapshot.extractedText || "");
  const collapsed = collapseWhitespace(text);

  const hops = [snapshot.finalUrl, ...((snapshot.redirectChain || []).map((hop) => hop.url))].filter(Boolean);
  const offending = hops.find((url) => !checkUrl(url).ok);
  checks.push(check("source_official", !offending, { category: U, detail: offending ? `${offending} is not an https uscis.gov address` : `fetched from ${snapshot.finalUrl}` }));

  const fetchedAt = snapshot.fetchedAt ? new Date(snapshot.fetchedAt) : null;
  const age = fetchedAt ? new Date(now).getTime() - fetchedAt.getTime() : Infinity;
  checks.push(check("source_fresh", age >= 0 && age <= FRESHNESS_WINDOW_MS, { category: U, detail: fetchedAt ? `fetched ${Math.round(age / 60000)} minute(s) ago` : "no fetch time recorded" }));

  const quote = collapseWhitespace(submission.quote);
  checks.push(check("quote_verbatim", Boolean(quote) && collapsed.includes(quote), { category: U, detail: quote ? (collapsed.includes(quote) ? "the quoted text appears exactly in the fetched official page" : "the quoted text does NOT appear in the fetched official page") : "no quote supplied" }));

  checks.push(check("edition_in_snapshot", containsDate(text, submission.editionIdentifier), { category: U, detail: `edition ${submission.editionIdentifier} ${containsDate(text, submission.editionIdentifier) ? "is" : "is NOT"} named in the fetched official page` }));
  checks.push(check("quote_names_edition", containsDate(quote, submission.editionIdentifier), { category: U, severity: "advisory", detail: `the quoted sentence ${containsDate(quote, submission.editionIdentifier) ? "names" : "does not itself name"} the edition (advisory: the reviewer's confirmation must tie the quote to this edition)` }));

  if (!artifact || !artifact.template) {
    checks.push(check("template_edition_matches", false, { category: U, detail: `no installed ${submission.formCode} template has edition ${submission.editionIdentifier}, so the page cannot be checked against an artifact` }));
  } else {
    const trusted = artifact.editionDateSource !== "version_backfill";
    const sameEdition = artifact.editionDate === submission.editionIdentifier;
    const samePage = !artifact.publishedEditionDate || artifact.publishedEditionDate === submission.editionIdentifier;
    checks.push(check("template_edition_matches", trusted && sameEdition && samePage, {
      category: C,
      detail: !trusted ? "the template's edition date came from version_backfill (an import date), so it cannot vouch for this edition"
        : !sameEdition ? `the template's edition date is ${artifact.editionDate || "unknown"}, not ${submission.editionIdentifier}`
        : !samePage ? `the USCIS page edition recorded at import was ${artifact.publishedEditionDate}, not ${submission.editionIdentifier}`
        : "template edition date, page edition and the claimed edition agree",
    }));
    const footerMatches = Boolean(artifact.pdfPrintedEdition) && artifact.pdfPrintedEdition === submission.editionIdentifier;
    if (!artifact.pdfChecksumStored || !artifact.pdfChecksumFetched) {
      const why = !artifact.pdfChecksumStored ? "the template has no stored PDF checksum to compare with" : "the official PDF could not be re-downloaded to compare checksums";
      if (footerMatches) checks.push(check("pdf_printed_edition_matches", true, { category: U, detail: `${why}; the stored PDF itself prints edition ${submission.editionIdentifier} in its footer` }));
      else checks.push(check("pdf_checksum_matches", false, { category: U, detail: `${why}${artifact.pdfPrintedEdition ? `; the stored PDF prints edition ${artifact.pdfPrintedEdition}` : ""}` }));
    } else {
      const same = artifact.pdfChecksumStored === artifact.pdfChecksumFetched;
      checks.push(check("pdf_checksum_matches", same, { category: C, detail: same ? "the official PDF's sha256 equals the imported PDF's" : "the official PDF's sha256 differs from the imported PDF's for this edition" }));
    }
  }

  const claimed = Object.entries(submission.claimedDates || {}).filter(([, value]) => value);
  const unmatched = claimed.filter(([, value]) => !containsDate(quote, value));
  checks.push(check("dates_match_quote", unmatched.length === 0, { category: C, detail: claimed.length ? (unmatched.length ? `${unmatched.map(([name, value]) => `${name} ${value}`).join(", ")} not found in the quoted text` : "every claimed date appears in the quoted text") : "no dates claimed" }));

  return summarize(checks);
}

function summarize(checks) {
  const failing = checks.filter((item) => !item.passed && item.severity === "blocking");
  const overall = failing.some((item) => item.category === VERIFICATION_RESULTS.CONFLICTING)
    ? VERIFICATION_RESULTS.CONFLICTING
    : failing.length ? VERIFICATION_RESULTS.UNVERIFIABLE : VERIFICATION_RESULTS.VERIFIED;
  return { overall, checks, failed: failing.map((item) => item.name) };
}

module.exports = { verifyEvidence, containsDate, dateVariants };
