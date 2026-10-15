// Plan Rule D: what the system verifies automatically, and what the gate WOULD answer. Pure, DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyEvidence, containsDate, dateVariants } = require("../EvidenceVerifier");
const gate = require("../EditionPolicyGate");
const { GATE_REASONS } = require("../editionPolicy.constants");
const { PAGE_TEXT, QUOTE, edition } = require("./helpers");

const NOW = new Date("2026-10-16T10:00:00Z");
const snapshot = (overrides = {}) => ({ finalUrl: "https://www.uscis.gov/alert", redirectChain: [{ url: "https://www.uscis.gov/alert" }], fetchedAt: new Date("2026-10-16T09:30:00Z"), extractedText: PAGE_TEXT, ...overrides });
const artifact = (overrides = {}) => ({ template: true, editionDate: edition, editionDateSource: "uscis_page", publishedEditionDate: null, pdfChecksumStored: "abc", pdfChecksumFetched: "abc", ...overrides });
const submission = (overrides = {}) => ({ formCode: "I-131", editionIdentifier: edition, quote: QUOTE, claimedDates: {}, ...overrides });
const verify = (parts = {}) => verifyEvidence({ submission: submission(parts.submission), snapshot: parts.snapshot === null ? null : snapshot(parts.snapshot), artifact: parts.artifact === null ? null : artifact(parts.artifact), now: NOW });
const failedChecks = (result) => result.checks.filter((item) => !item.passed && item.severity === "blocking").map((item) => item.name);

// ---- dates ----
test("dateVariants / containsDate understand the ways USCIS writes a date, without matching inside longer dates", () => {
  assert.ok(dateVariants("2025-01-20").includes("01/20/25") && dateVariants("2025-01-20").includes("January 20, 2025"));
  for (const text of ["edition 01/20/25", "edition 1/20/2025", "dated 2025-01-20", "on January 20, 2025.", "Jan. 20, 2025", "20 January 2025"]) assert.equal(containsDate(text, "2025-01-20"), true, text);
  for (const text of ["edition 11/20/25", "edition 01/20/2026", "edition 101/20/25", "no date here"]) assert.equal(containsDate(text, "2025-01-20"), false, text);
  assert.deepEqual(dateVariants("garbage"), []);
});

// ---- verification ----
test("a good claim verifies: source official + fresh, quote verbatim, edition named, template and PDF agree", () => {
  const result = verify();
  assert.equal(result.overall, "verified");
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.checks.map((item) => item.name), ["source_official", "source_fresh", "quote_verbatim", "edition_in_snapshot", "quote_names_edition", "template_edition_matches", "pdf_checksum_matches", "dates_match_quote"]);
});

test("a quote the system did not find in its own snapshot is unverifiable (a typed claim never counts)", () => {
  const result = verify({ submission: { quote: "USCIS will accept the 01/20/25 edition of Form I-131 for filing from today." } });
  assert.equal(result.overall, "unverifiable");
  assert.deepEqual(result.failed, ["quote_verbatim"]);
});

test("the quote is compared verbatim after whitespace collapsing only (case and wording must match)", () => {
  assert.equal(verify({ submission: { quote: "USCIS   will accept the 01/20/25\n edition of Form I-131 for filing." } }).overall, "verified");
  assert.equal(verify({ submission: { quote: "uscis will accept the 01/20/25 edition of Form I-131 for filing." } }).overall, "unverifiable");
  assert.equal(verify({ submission: { quote: "USCIS will accept the 01/20/25 edition of the Form I-131 for filing." } }).overall, "unverifiable");
});

test("an edition the page never names is unverifiable", () => {
  const result = verify({ snapshot: { extractedText: "USCIS will accept the new edition of Form I-131 for filing." }, submission: { quote: "USCIS will accept the new edition of Form I-131 for filing." } });
  assert.equal(result.overall, "unverifiable");
  assert.ok(result.failed.includes("edition_in_snapshot"));
});

test("the advisory check never blocks: a quote that does not itself name the edition still verifies", () => {
  const text = "Edition 01/20/25 is current. USCIS accepts this form for filing on the date shown.";
  const result = verify({ snapshot: { extractedText: text }, submission: { quote: "USCIS accepts this form for filing on the date shown." } });
  assert.equal(result.overall, "verified");
  assert.equal(result.checks.find((item) => item.name === "quote_names_edition").passed, false);
  assert.equal(result.checks.find((item) => item.name === "quote_names_edition").severity, "advisory");
});

test("a source that is not an https uscis.gov address, or any hop that is not, is refused", () => {
  assert.ok(verify({ snapshot: { finalUrl: "https://evil.example.com/x" } }).failed.includes("source_official"));
  assert.ok(verify({ snapshot: { redirectChain: [{ url: "https://www.uscis.gov/a" }, { url: "http://www.uscis.gov/b" }] } }).failed.includes("source_official"));
});

test("a stale snapshot is refused (fetched more than 24 hours ago)", () => {
  assert.ok(verify({ snapshot: { fetchedAt: new Date("2026-10-14T09:00:00Z") } }).failed.includes("source_fresh"));
  assert.ok(verify({ snapshot: { fetchedAt: null } }).failed.includes("source_fresh"));
});

test("a template edition date from version_backfill, a different edition, or a different page edition is CONFLICTING", () => {
  for (const override of [{ editionDateSource: "version_backfill" }, { editionDate: "2026-09-18" }, { publishedEditionDate: "2025-02-27" }]) {
    const result = verify({ artifact: override });
    assert.equal(result.overall, "conflicting", JSON.stringify(override));
    assert.ok(result.failed.includes("template_edition_matches"));
  }
});

test("no template of that edition means the claim cannot be checked against an artifact (unverifiable)", () => {
  const result = verify({ artifact: null });
  assert.equal(result.overall, "unverifiable");
  assert.ok(result.failed.includes("template_edition_matches"));
});

test("PDF checksum: a mismatch is conflicting; a PDF that could not be re-downloaded or has no stored checksum is unverifiable", () => {
  assert.equal(verify({ artifact: { pdfChecksumFetched: "different" } }).overall, "conflicting");
  assert.equal(verify({ artifact: { pdfChecksumFetched: null } }).overall, "unverifiable");
  assert.equal(verify({ artifact: { pdfChecksumStored: null } }).overall, "unverifiable");
});

test("claimed dates must appear in the quoted text; a date not in the quote is conflicting", () => {
  const withDates = { snapshot: { extractedText: "USCIS will accept the 01/20/25 edition of Form I-131 for filing starting 03/01/2026." }, submission: { quote: "USCIS will accept the 01/20/25 edition of Form I-131 for filing starting 03/01/2026.", claimedDates: { effectiveDate: "2026-03-01" } } };
  assert.equal(verify(withDates).overall, "verified");
  const wrong = verify({ ...withDates, submission: { ...withDates.submission, claimedDates: { effectiveDate: "2026-04-01" } } });
  assert.equal(wrong.overall, "conflicting");
  assert.deepEqual(wrong.failed, ["dates_match_quote"]);
});

test("conflicting outranks unverifiable when both apply; a failed fetch is unverifiable", () => {
  assert.equal(verify({ submission: { quote: "not on the page at all, just some other long sentence" }, artifact: { editionDate: "2026-09-18" } }).overall, "conflicting");
  const noFetch = verify({ snapshot: null });
  assert.equal(noFetch.overall, "unverifiable");
  assert.deepEqual(noFetch.failed, ["source_fetched"]);
});

// ---- the gate ----
const storeWith = (row) => ({ findDecision: async () => row });
const accepted = (overrides = {}) => ({ formCode: "I-131", editionIdentifier: edition, decision: "accepted", status: "verified", reviewBy: new Date("2027-01-01"), holdReason: "", version: 3, ...overrides });
const check = (row, at = NOW) => gate.check("I-131", edition, { store: storeWith(row), now: at });

test("no record NEVER authorizes: held with no_policy", async () => {
  const result = await check(null);
  assert.deepEqual({ allowed: result.allowed, decision: result.decision, reasons: result.reasons }, { allowed: false, decision: "held", reasons: [GATE_REASONS.NO_POLICY] });
});

test("an accepted, verified, in-date, un-held decision is the only thing that allows", async () => {
  const result = await check(accepted());
  assert.deepEqual({ allowed: result.allowed, decision: result.decision, status: result.status, reasons: result.reasons, decisionVersion: result.decisionVersion }, { allowed: true, decision: "accepted", status: "verified", reasons: [], decisionVersion: 3 });
});

test("not_accepted is blocked outright; grandfathered is serve-only; held carries its reason", async () => {
  const blocked = await check(accepted({ decision: "not_accepted" }));
  assert.equal(blocked.allowed, false);
  assert.deepEqual(blocked.reasons, [GATE_REASONS.NOT_ACCEPTED]);
  const grandfathered = await check(accepted({ decision: "grandfathered" }));
  assert.deepEqual([grandfathered.allowed, grandfathered.reasons], [false, [GATE_REASONS.GRANDFATHERED]]);
  const heldRow = await check(accepted({ decision: "held", holdReason: "waiting for the court order text" }));
  assert.deepEqual([heldRow.allowed, heldRow.decision, heldRow.reasons], [false, "held", [GATE_REASONS.HELD, "waiting for the court order text"]]);
});

test("accepted but unverified, stale, conflicting, held-flagged, past its review date, or not yet effective is held", async () => {
  assert.deepEqual((await check(accepted({ status: "unverified" }))).reasons, [GATE_REASONS.UNVERIFIED]);
  assert.deepEqual((await check(accepted({ status: "stale" }))).reasons, [GATE_REASONS.STALE]);
  assert.deepEqual((await check(accepted({ status: "conflicting" }))).reasons, [GATE_REASONS.CONFLICTING]);
  assert.ok((await check(accepted({ holdReason: "x" }))).reasons.includes(GATE_REASONS.HELD));
  assert.ok((await check(accepted({ reviewBy: new Date("2026-10-01") }))).reasons.includes(GATE_REASONS.STALE));
  assert.ok((await check(accepted({ effectiveDate: new Date("2027-01-01") }))).reasons.includes(GATE_REASONS.NOT_YET_EFFECTIVE));
  for (const row of [accepted({ status: "stale" }), accepted({ effectiveDate: new Date("2027-01-01") })]) assert.equal((await check(row)).allowed, false);
});

test("past the rejection date (and any grace period) the edition is blocked like an explicit not_accepted", async () => {
  const row = accepted({ rejectionDate: new Date("2026-10-01") });
  assert.deepEqual([(await check(row)).allowed, (await check(row)).decision, (await check(row)).reasons], [false, "not_accepted", [GATE_REASONS.NO_LONGER_ACCEPTED]]);
  assert.equal((await check(accepted({ rejectionDate: new Date("2026-10-01"), graceUntil: new Date("2026-12-01") }))).allowed, true, "inside the grace period it is still allowed");
  assert.equal((await check(accepted({ rejectionDate: new Date("2026-11-01") }))).allowed, true, "before the rejection date");
});

test("FAIL CLOSED: any error, a bad input, or a store that throws is held, never allowed, and the gate never throws", async () => {
  const throwing = { findDecision: async () => { throw new Error("db down"); } };
  assert.deepEqual((await gate.check("I-131", edition, { store: throwing })).reasons, [GATE_REASONS.GATE_ERROR]);
  assert.equal((await gate.check("I-131", edition, { store: throwing })).allowed, false);
  assert.deepEqual((await gate.check("I-131", edition, {})).reasons, [GATE_REASONS.GATE_ERROR]);
  assert.deepEqual((await gate.check("I-131", "01/20/25", { store: storeWith(accepted()) })).reasons, [GATE_REASONS.INVALID_EDITION]);
  assert.deepEqual((await gate.check("", edition, { store: storeWith(accepted()) })).reasons, [GATE_REASONS.INVALID_EDITION]);
  assert.equal((await check({ decision: "weird", status: "verified" })).allowed, false);
});

test("the gate looks up the EXACT edition: a decision for one edition never authorizes another", async () => {
  const lookups = [];
  const store = { findDecision: async (formCode, editionIdentifier) => { lookups.push([formCode, editionIdentifier]); return editionIdentifier === edition ? accepted() : null; } };
  assert.equal((await gate.check("I-131", edition, { store, now: NOW })).allowed, true);
  assert.equal((await gate.check("I-131", "2026-09-18", { store, now: NOW })).allowed, false);
  assert.deepEqual(lookups, [["I-131", edition], ["I-131", "2026-09-18"]]);
});
