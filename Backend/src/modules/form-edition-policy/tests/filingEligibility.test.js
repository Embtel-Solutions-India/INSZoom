// FilingEligibilityStatement validated against REAL uscis.gov page text (tests/fixtures/uscisPages.json, fetched 2026-10-15), plus the edge cases.
const test = require("node:test");
const assert = require("node:assert/strict");
const { filingEligibilityStatement, pageEditionDate, numericDateToIso, longDateToIso, explicitStatements } = require("../filingEligibility");
const { collapseWhitespace } = require("../htmlText");
const fixtures = require("./fixtures/uscisPages.json");

const run = (form, edition, override = {}) => filingEligibilityStatement({ text: fixtures[form].text, formCode: form, editionIdentifier: edition, ...override });
const inText = (form, quote) => collapseWhitespace(fixtures[form].text).includes(quote);

test("date helpers", () => {
  assert.equal(numericDateToIso("09/17/18"), "2018-09-17");
  assert.equal(numericDateToIso("9/7/2026"), "2026-09-07");
  assert.equal(numericDateToIso("13/40/26"), null);
  assert.equal(longDateToIso("Oct. 1, 2026"), "2026-10-01");
  assert.equal(longDateToIso("on or before November 9, 2026"), "2026-11-09");
  assert.equal(longDateToIso("no date"), null);
});

test("the page's own Edition Date is read from the real pages (one distinct date or nothing)", () => {
  assert.equal(pageEditionDate(collapseWhitespace(fixtures["G-1041"].text)), "2024-04-01");
  assert.equal(pageEditionDate(collapseWhitespace(fixtures["I-90"].text)), "2025-01-20");
  assert.equal(pageEditionDate(collapseWhitespace(fixtures["G-1055"].text)), "2026-10-07", "the same date twice is still one date");
  assert.equal(pageEditionDate("Edition Date 01/01/24 ... Edition Date 02/02/25"), null, "two different dates are ambiguous");
  assert.equal(pageEditionDate("no field"), null);
});

// ---- accepted: USCIS's own "current acceptable edition" statement + the page's own Edition Date ----
test("G-1041 (real page): the current acceptable edition statement + Edition Date 04/01/24 => accepted, quoted verbatim", () => {
  const result = run("G-1041", "2024-04-01");
  assert.equal(result.verdict, "accepted");
  assert.equal(result.pattern, "current_acceptable_edition");
  assert.match(result.quote, /^The current acceptable edition can be found under the Edition Date section/);
  assert.ok(inText("G-1041", result.quote), "the quote is verbatim in the page");
  assert.equal(result.ambiguous, false);
});

test("I-90 (real page, the other wording of the statement) => accepted for 01/20/25", () => {
  const result = run("I-90", "2025-01-20");
  assert.equal(result.verdict, "accepted");
  assert.equal(result.quote, "You can find the current acceptable edition under the Edition Date section on each form’s webpage.");
  assert.ok(inText("I-90", result.quote));
});

test("the statement only establishes the edition the PAGE lists: any other edition gets nothing from it", () => {
  assert.equal(run("G-1041", "2023-01-01").verdict, "none");
  assert.equal(run("I-90", "2024-12-31").verdict, "none");
});

test("the edition the page itself publishes as current is accepted without an explicit sentence (user decision), quoted verbatim from the page", () => {
  for (const [form, edition, shown] of [["G-1055", "2026-10-07", "Edition Date 10/07/26"], ["AR-11", "2022-11-02", "Edition Date 11/02/22"], ["I-131", "2025-01-20", "Edition Date 01/20/25"], ["N-400", "2025-01-20", "Edition Date 01/20/25"]]) {
    const result = run(form, edition);
    assert.equal(result.verdict, "accepted", form);
    assert.equal(result.pattern, "current_official_edition", form);
    assert.ok(result.quote.includes(shown), `${form}: ${result.quote}`);
    assert.ok(inText(form, result.quote), `${form}: the quote must be verbatim in the page`);
    assert.equal(result.dates.effectiveDate, null);
  }
});

test("an edition the page does NOT list as current, with no statement about it, stays held (older editions are not accepted by silence)", () => {
  assert.equal(run("I-131", "2024-01-01").verdict, "none");
  assert.equal(run("N-400", "2023-04-01").verdict, "none");
  assert.equal(run("G-1055", "2026-10-06").verdict, "none");
});

test("a page that lists an edition as current but refuses it is not_accepted (the refusal wins over the publication)", () => {
  const text = "Form Details Edition Date 01/20/25 . USCIS will not accept the 01/20/25 edition of Form I-131 after Oct. 1, 2026.";
  const result = filingEligibilityStatement({ text, formCode: "I-131", editionIdentifier: "2025-01-20" });
  assert.equal(result.verdict, "not_accepted");
});

// ---- explicit, named statements ----
test("I-539 (real court-order alert): the 08/28/24 edition is accepted, the 09/15/26 edition is not, and the I-765 date does not count", () => {
  const accepted = run("I-539", "2024-08-28");
  assert.equal(accepted.verdict, "accepted");
  assert.equal(accepted.pattern, "explicit_accept");
  assert.match(accepted.quote, /USCIS continues to accept the 08\/28\/24 edition of Form I-539/);
  assert.ok(inText("I-539", accepted.quote));
  const blocked = run("I-539", "2026-09-15");
  assert.equal(blocked.verdict, "not_accepted");
  assert.equal(blocked.pattern, "explicit_not_accept");
  assert.match(blocked.quote, /is not accepting the 09\/15\/26 edition of Forms I-539 and I-765/);
  assert.equal(run("I-539", "2025-08-21").verdict, "none", "08/21/25 is attributed to Form I-765, not I-539");
});

test("I-765 (same alert): its own 08/21/25 edition is accepted, 09/15/26 is not, and I-539's date does not count", () => {
  assert.equal(run("I-765", "2025-08-21").verdict, "accepted");
  assert.equal(run("I-765", "2026-09-15").verdict, "not_accepted");
  assert.equal(run("I-765", "2024-08-28").verdict, "none");
});

test("I-864 (real grace-period alert): the new 08/24/26 edition is accepted; the old 10/17/24 edition is ambiguous (accepted in grace, refused later) so it stays held", () => {
  const next = run("I-864", "2026-08-24");
  assert.equal(next.verdict, "accepted");
  assert.match(next.quote, /Beginning Oct\. 1, 2026, we will only accept the 08\/24\/26 edition of Form I-864/);
  assert.equal(next.dates.effectiveDate, null, "'Beginning <date>, we will only accept X' marks when OLDER editions stop; X itself is usable now");
  assert.ok(inText("I-864", next.quote));
  const old = run("I-864", "2024-10-17");
  assert.equal(old.verdict, "none");
  assert.equal(old.ambiguous, true);
});

test("G-28 (real page): 'you may continue using the 09/17/18 and 05/23/18 editions' names both editions", () => {
  assert.equal(run("G-28", "2018-09-17").verdict, "accepted");
  assert.equal(run("G-28", "2018-05-23").verdict, "accepted");
  assert.match(run("G-28", "2018-09-17").quote, /you may continue using the 09\/17\/18 and 05\/23\/18 editions/);
});

test("statements that name no edition ('USCIS will continue to accept prior editions of Form G-1450') accept nothing by themselves: only the edition the page lists as current is accepted", () => {
  assert.equal(run("G-1450", "2026-02-06").pattern, "current_official_edition");
  assert.equal(run("G-1450", "2025-01-01").verdict, "none");
});

test("I-129 (real page): 'we will accept only the 09/09/26 edition' accepts it; the old 02/27/26 edition (accepted before Nov. 9, rejected after) is ambiguous; the filing-location grace period is ignored", () => {
  const next = run("I-129", "2026-09-09");
  assert.equal(next.verdict, "accepted");
  assert.equal(next.quote, "Starting Nov. 9, 2026, we will accept only the 09/09/26 edition of Form I-129.");
  assert.equal(next.dates.effectiveDate, null);
  assert.ok(inText("I-129", next.quote));
  const old = run("I-129", "2026-02-27");
  assert.deepEqual([old.verdict, old.ambiguous], ["none", true]);
});

// ---- ambiguity and safety ----
test("an edition named by both an accepting and a not-accepting statement is ambiguous and stays held", () => {
  const text = "Alert. USCIS continues to accept the 01/20/25 edition of Form I-131. Later, USCIS is not accepting the 01/20/25 edition of Form I-131.";
  const result = filingEligibilityStatement({ text, formCode: "I-131", editionIdentifier: "2025-01-20" });
  assert.deepEqual([result.verdict, result.ambiguous, result.evidence.length], ["none", true, 2]);
});

test("a page that lists an edition as current but another sentence refuses it is ambiguous", () => {
  const text = "Alert. USCIS is not accepting the 04/01/24 edition of Form G-1041. The current acceptable edition can be found under the Edition Date section on each form’s webpage. Forms and Document Downloads Form Details Edition Date 04/01/24 .";
  const result = filingEligibilityStatement({ text, formCode: "G-1041", editionIdentifier: "2024-04-01" });
  assert.equal(result.verdict, "none");
  assert.equal(result.ambiguous, true);
});

test("silence, the form code elsewhere, bad input and empty text never produce a verdict", () => {
  assert.equal(filingEligibilityStatement({ text: "", formCode: "I-131", editionIdentifier: "2025-01-20" }).verdict, "none");
  assert.equal(filingEligibilityStatement({ text: "anything", formCode: "", editionIdentifier: "2025-01-20" }).verdict, "none");
  assert.equal(filingEligibilityStatement({ text: "USCIS will accept the 01/20/25 edition", formCode: "I-131", editionIdentifier: "01/20/25" }).verdict, "none");
  assert.equal(filingEligibilityStatement({ text: null, formCode: "I-131", editionIdentifier: "2025-01-20" }).verdict, "none");
});

test("an edition named for ANOTHER form on this form's page does not count", () => {
  const text = "USCIS will accept the 01/20/25 edition of Form I-485.";
  assert.equal(filingEligibilityStatement({ text, formCode: "I-131", editionIdentifier: "2025-01-20" }).verdict, "none");
  assert.equal(filingEligibilityStatement({ text, formCode: "I-485", editionIdentifier: "2025-01-20" }).verdict, "accepted");
});

test("without a form named, a date counts only when no other form is mentioned in the clause", () => {
  assert.equal(filingEligibilityStatement({ text: "USCIS will accept the 01/20/25 edition.", formCode: "I-131", editionIdentifier: "2025-01-20" }).verdict, "accepted");
  assert.equal(filingEligibilityStatement({ text: "With Form I-485 pending, USCIS will accept the 01/20/25 edition.", formCode: "I-131", editionIdentifier: "2025-01-20" }).verdict, "none");
});

test("the quote is always a verbatim slice of the page, so the verifier can prove it", () => {
  for (const [form, edition] of [["G-1041", "2024-04-01"], ["I-90", "2025-01-20"], ["I-539", "2024-08-28"], ["I-539", "2026-09-15"], ["I-864", "2026-08-24"], ["G-28", "2018-05-23"]]) {
    const result = run(form, edition);
    assert.notEqual(result.verdict, "none", `${form} ${edition}`);
    assert.ok(inText(form, result.quote), `${form} ${edition}: quote not verbatim`);
    assert.ok(result.quote.length <= 700 && result.quote.length >= 25);
  }
});

test("clause polarity: a not-accepting clause never turns an accepted edition into a rejected one", () => {
  const found = explicitStatements("USCIS continues to accept the 08/28/24 edition of Form I-539 and 08/21/25 edition of Form I-765 and is not accepting the 09/15/26 edition of Forms I-539 and I-765.", "I-539");
  assert.deepEqual(found.map((item) => [item.kind, item.edition]), [["accepted", "2024-08-28"], ["not_accepted", "2026-09-15"]]);
});

const { parentFormCodeOf, pageMentionsForm } = require("../filingEligibility");

test("a supplement without a page of its own is governed by its parent form's page, and only if that page lists it", () => {
  assert.deepEqual(["I-539A", "I-485J", "I-130A", "I-918SUPA", "I-918 SUPPLEMENT B", "I-485A"].map(parentFormCodeOf), ["I-539", "I-485", "I-130", "I-918", "I-918", "I-485"]);
  assert.deepEqual(["I-129", "I-765", "N-400", ""].map(parentFormCodeOf), [null, null, null, null]);
  assert.equal(pageMentionsForm(fixtures["I-539"].text, "I-539A"), true, "the I-539 page lists Form I-539A (PDF)");
  assert.equal(pageMentionsForm(fixtures["I-539"].text, "I-539Z"), false);
  assert.equal(pageMentionsForm("Form I-918, Supplement A (PDF)", "I-918 SUPPLEMENT A"), true);
  assert.equal(pageMentionsForm("Form I-918, Supplement B (PDF)", "I-918SUPA"), false);
});
