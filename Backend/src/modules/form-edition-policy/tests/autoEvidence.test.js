// Release 0b-2: AUTOMATIC evidence. Nobody supplies a URL or quote; the system fetches the official page, looks for an EXPLICIT statement about the edition
// and records a machine decision only for that. Real uscis.gov page text (fixtures) drives the scenarios; in-memory store, scripted fetchers - no database,
// no network, no writes anywhere real.
const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("./helpers");
const fixtures = require("./fixtures/uscisPages.json");

const { build, template, admin, lead, user } = H;
const pageUrl = (code) => `https://www.uscis.gov/${code.toLowerCase()}`;
const day = (iso) => new Date(`${iso}T00:00:00Z`);
// a template of one real form + edition, with the official PDF matching the imported one
const tpl = (formCode, edition, over = {}) => template({ _id: `tpl-${formCode}-${edition}`, formCode, version: edition, editionDate: day(edition), ...over });
const withPage = (form, edition, over = {}) => build({ templates: [tpl(form, edition, over.template)], html: H.okFetch(fixtures[form].text), resolvePageUrl: pageUrl, ...over.build });
const nothingWritten = (store) => assert.deepEqual([store.events.length, store.snapshots.length, store.decisions.size], [0, 0, 0], "no database write of any kind");

test("I-90 (real page text): the explicit 'current acceptable edition' statement is found by the system and the edition is accepted automatically", async () => {
  const { service, store } = withPage("I-90", "2025-01-20");
  const result = await service.runAutomaticCheck("I-90", "2025-01-20", { trigger: "test" });
  assert.equal(result.outcome, "accepted");
  assert.equal(result.pattern, "current_acceptable_edition");
  assert.equal(result.gate.allowed, true);
  const row = [...store.decisions.values()][0];
  assert.deepEqual([row.decision, row.status, row.decidedBy.label, row.decidedBy.userId, row.version], ["accepted", "verified", "pipeline:official_source", null, 1]);
  assert.match(row.quote, /current acceptable edition under the Edition Date section/);
  assert.match(row.rationale, /Automatic: USCIS's own page states/);
  assert.deepEqual(store.events.map((event) => event.type), ["EVIDENCE_SUBMITTED", "SOURCE_FETCHED", "VERIFICATION_COMPLETED", "DECISION_RECORDED", "GATE_RECALCULATED"]);
  const recorded = store.events[3].payload;
  assert.deepEqual([recorded.automatic, recorded.explicitConfirmation, recorded.verification], [true, false, "verified"]);
  assert.equal(store.events[0].payload.automatic, true);
  assert.deepEqual([store.events[0].actor.role, store.events[0].actor.label], ["system", "pipeline:official_source"]);
  assert.equal(store.snapshots.length, 1);
  assert.equal(row.evidenceRefs[0].snapshotHash, store.snapshots[0].snapshotHash);
});

test("I-129 (real page): 'we will accept only the 09/09/26 edition' is accepted automatically and usable now (no effective date)", async () => {
  const { service, store } = withPage("I-129", "2026-09-09");
  const result = await service.runAutomaticCheck("I-129", "2026-09-09");
  assert.equal(result.outcome, "accepted");
  assert.equal(result.pattern, "explicit_accept");
  assert.equal(result.gate.allowed, true);
  assert.equal([...store.decisions.values()][0].effectiveDate, null);
});

test("I-539 (real page): the court-order alert names the 09/15/26 edition as NOT accepted - recorded automatically; the gate blocks it", async () => {
  const { service, store } = withPage("I-539", "2026-09-15");
  const result = await service.runAutomaticCheck("I-539", "2026-09-15");
  assert.equal(result.outcome, "not_accepted");
  assert.deepEqual([result.gate.allowed, result.gate.decision, result.gate.reasons], [false, "not_accepted", ["not_accepted_by_uscis"]]);
  assert.equal([...store.decisions.values()][0].reviewBy instanceof Date, true);
  assert.equal(store.events.find((event) => event.type === "DECISION_RECORDED").payload.restrictsOnly, true);
});

test("a restriction is recorded even when the artifacts disagree (it only restricts), but an acceptance never is", async () => {
  const mismatched = { build: { pdf: H.pdfFetch(Buffer.from("a different official pdf")) } };
  const notAccepted = withPage("I-539", "2026-09-15", mismatched);
  assert.equal((await notAccepted.service.runAutomaticCheck("I-539", "2026-09-15")).outcome, "not_accepted");
  const accepted = withPage("I-90", "2025-01-20", mismatched);
  const result = await accepted.service.runAutomaticCheck("I-90", "2025-01-20");
  assert.equal(result.outcome, "held_unverified");
  assert.deepEqual(result.verification.failed, ["pdf_checksum_matches"]);
  nothingWritten(accepted.store);
});

test("the edition the page publishes as current (I-131, N-400, AR-11, G-1055) is accepted without an explicit sentence, quoting the page's own Edition Date", async () => {
  for (const [form, edition] of [["G-1055", "2026-10-07"], ["AR-11", "2022-11-02"], ["I-131", "2025-01-20"], ["N-400", "2025-01-20"]]) {
    // the stored PDF's footer vouches for the edition where there is no checksum to compare (the seeded-form case)
    const { service, store } = withPage(form, edition, { template: { importMetadata: { editionDateSource: "pdf" } }, build: { readPrintedEdition: async () => edition } });
    const result = await service.runAutomaticCheck(form, edition);
    assert.equal(result.outcome, "accepted", form);
    assert.equal(result.pattern, "current_official_edition", form);
    assert.match([...store.decisions.values()][0].quote, /Edition Date \d\d\/\d\d\/\d\d/);
  }
});

test("an OLDER edition (the page lists a different current one) is not accepted by silence and nothing is written", async () => {
  const { service, store } = withPage("I-131", "2024-01-01");
  assert.equal((await service.runAutomaticCheck("I-131", "2024-01-01")).outcome, "no_explicit_statement");
  nothingWritten(store);
});

test("when no checksum can be compared the stored PDF's own footer must print the edition; a different or unreadable footer holds it", async () => {
  const noChecksum = { template: { importMetadata: { editionDateSource: "pdf" }, lifecycle: {} } };
  const same = withPage("I-131", "2025-01-20", { ...noChecksum, build: { readPrintedEdition: async () => "2025-01-20" } });
  assert.equal((await same.service.runAutomaticCheck("I-131", "2025-01-20")).outcome, "accepted");
  for (const printed of ["2024-04-01", null]) {
    const held = withPage("I-131", "2025-01-20", { ...noChecksum, build: { readPrintedEdition: async () => printed } });
    const result = await held.service.runAutomaticCheck("I-131", "2025-01-20");
    assert.equal(result.outcome, "held_unverified", String(printed));
    assert.deepEqual(result.verification.failed, ["pdf_checksum_matches"]);
    nothingWritten(held.store);
  }
  const throwing = withPage("I-131", "2025-01-20", { ...noChecksum, build: { readPrintedEdition: async () => { throw new Error("storage down"); } } });
  assert.equal((await throwing.service.runAutomaticCheck("I-131", "2025-01-20")).outcome, "held_unverified");
});

test("a checksum that WAS compared and differs still holds, whatever the footer says", async () => {
  const { service, store } = withPage("I-131", "2025-01-20", { build: { pdf: H.pdfFetch(Buffer.from("a different official pdf")), readPrintedEdition: async () => "2025-01-20" } });
  const result = await service.runAutomaticCheck("I-131", "2025-01-20");
  assert.deepEqual([result.outcome, result.verification.failed], ["held_unverified", ["pdf_checksum_matches"]]);
  nothingWritten(store);
});

test("an ambiguous page (an edition both accepted and refused) is reported as ambiguous and writes nothing", async () => {
  const text = "USCIS continues to accept the 01/20/25 edition of Form I-131. USCIS is not accepting the 01/20/25 edition of Form I-131.";
  const { service, store } = build({ templates: [tpl("I-131", "2025-01-20")], html: H.okFetch(text), resolvePageUrl: pageUrl });
  const result = await service.runAutomaticCheck("I-131", "2025-01-20");
  assert.deepEqual([result.outcome, result.ambiguous], ["no_explicit_statement", true]);
  nothingWritten(store);
});

test("nothing is attempted, and nothing is written, without a trusted template, an official page, or a reachable page", async () => {
  const none = build({ templates: [], html: H.okFetch(fixtures["I-90"].text), resolvePageUrl: pageUrl });
  assert.equal((await none.service.runAutomaticCheck("I-90", "2025-01-20")).outcome, "no_template");
  const backfilled = withPage("I-90", "2025-01-20", { template: { importMetadata: { editionDateSource: "version_backfill", checksum: template().importMetadata.checksum } } });
  assert.equal((await backfilled.service.runAutomaticCheck("I-90", "2025-01-20")).outcome, "edition_date_not_trusted");
  const noPage = build({ templates: [tpl("I-485 SUPPLEMENT A", "2025-01-20")], html: H.okFetch(""), pdf: async () => ({ ok: false, error: "HTTP 404" }), resolvePageUrl: () => null });
  assert.equal((await noPage.service.runAutomaticCheck("I-485 SUPPLEMENT A", "2025-01-20")).outcome, "no_official_page");
  const down = build({ templates: [tpl("I-90", "2025-01-20")], html: H.failFetch(), pdf: async () => ({ ok: false, error: "HTTP 404" }), resolvePageUrl: pageUrl });
  assert.equal((await down.service.runAutomaticCheck("I-90", "2025-01-20")).outcome, "fetch_failed");
  const bad = build({ templates: [tpl("I-90", "2025-01-20")], html: H.okFetch(""), resolvePageUrl: pageUrl });
  assert.equal((await bad.service.runAutomaticCheck("I-90", "garbage")).outcome, "no_template");
  for (const item of [none, backfilled, noPage, down, bad]) nothingWritten(item.store);
});

test("the page url comes from the template when it has one, otherwise from the form code", async () => {
  const seen = [];
  const html = async (url) => { seen.push(url); return H.okFetch(fixtures["I-90"].text)(url); };
  const stored = build({ templates: [tpl("I-90", "2025-01-20", { lifecycle: { sourcePageUrl: "https://www.uscis.gov/i-90-stored", sourceChecksum: template().lifecycle.sourceChecksum } })], html, resolvePageUrl: () => { throw new Error("must not be asked"); } });
  await stored.service.runAutomaticCheck("I-90", "2025-01-20");
  assert.equal(seen[0], "https://www.uscis.gov/i-90-stored");
  const guessed = build({ templates: [tpl("I-90", "2025-01-20")], html, resolvePageUrl: pageUrl });
  await guessed.service.runAutomaticCheck("I-90", "2025-01-20");
  assert.equal(seen[1], "https://www.uscis.gov/i-90");
});

test("running it again changes nothing ('unchanged'): no new events, no new version", async () => {
  const { service, store } = withPage("I-90", "2025-01-20");
  await service.runAutomaticCheck("I-90", "2025-01-20");
  const eventsBefore = store.events.length;
  const again = await service.runAutomaticCheck("I-90", "2025-01-20");
  assert.equal(again.outcome, "unchanged");
  assert.equal(store.events.length, eventsBefore);
  assert.equal([...store.decisions.values()][0].version, 1);
});

test("an edition already recorded as NOT accepted is never turned into accepted by the machine", async () => {
  const { service, store } = withPage("I-90", "2025-01-20");
  store.decisions.set("I-90|2025-01-20", { formCode: "I-90", editionIdentifier: "2025-01-20", decision: "not_accepted", status: "verified", version: 1, evidenceRefs: [] });
  const result = await service.runAutomaticCheck("I-90", "2025-01-20");
  assert.equal(result.outcome, "locked_not_accepted");
  assert.equal(store.decisions.get("I-90|2025-01-20").decision, "not_accepted");
  assert.equal(store.events.length, 0);
});

test("the machine may restrict an edition that was accepted (new statement, version bumped)", async () => {
  const { service, store } = withPage("I-539", "2026-09-15");
  store.decisions.set("I-539|2026-09-15", { formCode: "I-539", editionIdentifier: "2026-09-15", decision: "accepted", status: "verified", version: 1, evidenceRefs: [], quote: "old" });
  const result = await service.runAutomaticCheck("I-539", "2026-09-15");
  assert.equal(result.outcome, "not_accepted");
  assert.equal(result.decision.version, 2);
  assert.equal(store.decisions.size, 1);
});

test("two automatic checks racing for one edition are serialized (one row)", async () => {
  const { service, store } = withPage("I-90", "2025-01-20");
  const results = await Promise.all([service.runAutomaticCheck("I-90", "2025-01-20"), service.runAutomaticCheck("I-90", "2025-01-20")]);
  assert.deepEqual(results.map((item) => item.outcome).sort(), ["accepted", "unchanged"]);
  assert.equal(store.decisions.size, 1);
});

test("the admin / team lead 'Check now' button runs the same check; every other role is refused", async () => {
  const { service } = withPage("I-90", "2025-01-20");
  for (const role of ["super_admin", "case_manager", "attorney", "paralegal", "finance", "hr", "client"]) {
    await assert.rejects(service.autoCheck(user(role), "I-90", "2025-01-20"), (error) => error.status === 403 && error.code === "ROLE_NOT_ALLOWED", role);
  }
  assert.equal((await service.autoCheck(lead, "I-90", "2025-01-20")).outcome, "accepted");
  assert.equal((await service.autoCheck(admin, "I-90", "2025-01-20")).outcome, "unchanged");
});

test("OUTCOME_RECORDED is written only when a decision (and so an evidence case) exists, and is best effort", async () => {
  const { service, store } = withPage("I-90", "2025-01-20");
  assert.equal(await service.recordOutcome({ formCode: "I-90", editionIdentifier: "2025-01-20", outcome: "held", entryPoint: "test" }), null);
  assert.equal(store.events.length, 0, "no decision, no event");
  await service.runAutomaticCheck("I-90", "2025-01-20");
  const event = await service.recordOutcome({ formCode: "I-90", editionIdentifier: "2025-01-20", outcome: "gate_allowed", entryPoint: "VersionManagementService.activate", actor: { _id: "u1", role: "admin" } });
  assert.equal(event.type, "OUTCOME_RECORDED");
  assert.deepEqual([event.payload.outcome, event.payload.entryPoint, event.seq], ["gate_allowed", "VersionManagementService.activate", 6]);
  store.insertEvent = async () => { throw new Error("db down"); };
  assert.equal(await service.recordOutcome({ formCode: "I-90", editionIdentifier: "2025-01-20", outcome: "held", entryPoint: "x" }), null, "an audit failure never throws");
});

test("every quote the machine records is verbatim in the stored snapshot (the verifier proves it)", async () => {
  for (const [form, edition] of [["I-90", "2025-01-20"], ["I-129", "2026-09-09"], ["I-539", "2024-08-28"], ["I-864", "2026-08-24"], ["G-28", "2018-05-23"]]) {
    const { service, store } = withPage(form, edition);
    const result = await service.runAutomaticCheck(form, edition);
    assert.ok(["accepted", "held_unverified"].includes(result.outcome), `${form}: ${result.outcome}`);
    if (result.outcome === "accepted") {
      const check = store.events.find((event) => event.type === "VERIFICATION_COMPLETED").payload.checks.find((item) => item.name === "quote_verbatim");
      assert.equal(check.passed, true, `${form} quote must be verbatim`);
    }
  }
});

test("I-539A (no page of its own, HTTP 404): the parent I-539 page lists it and publishes edition 08/28/24, which the supplement's footer prints too -> accepted, quoting the parent page", async () => {
  const urls = [];
  const html = async (url) => { urls.push(url); return url.endsWith("/i-539a") ? { ok: false, error: "HTTP 404" } : H.okFetch(fixtures["I-539"].text)(url); };
  const { service, store } = build({
    templates: [tpl("I-539A", "2024-08-28", { importMetadata: { editionDateSource: "pdf" } })], html, resolvePageUrl: pageUrl, readPrintedEdition: async () => "2024-08-28",
  });
  const result = await service.runAutomaticCheck("I-539A", "2024-08-28");
  assert.deepEqual(urls, ["https://www.uscis.gov/i-539a", "https://www.uscis.gov/i-539"]);
  assert.equal(result.outcome, "accepted");
  assert.equal(result.sourceUrl, "https://www.uscis.gov/i-539");
  assert.match([...store.decisions.values()][0].quote, /Edition Date 08\/28\/24/);
});

test("a supplement the parent page does NOT list, or whose edition is not the page's, is not accepted and nothing is written", async () => {
  const html = async (url) => (url.endsWith("/i-539") ? H.okFetch(fixtures["I-539"].text)(url) : { ok: false, error: "HTTP 404" });
  const no404 = async () => ({ ok: false, error: "HTTP 404" });
  const unlisted = build({ templates: [tpl("I-539Z", "2024-08-28")], html, pdf: no404, resolvePageUrl: pageUrl, readPrintedEdition: async () => "2024-08-28" });
  assert.equal((await unlisted.service.runAutomaticCheck("I-539Z", "2024-08-28")).outcome, "supplement_not_listed");
  nothingWritten(unlisted.store);
  const older = build({ templates: [tpl("I-539A", "2023-01-01")], html, pdf: no404, resolvePageUrl: pageUrl, readPrintedEdition: async () => "2023-01-01" });
  assert.equal((await older.service.runAutomaticCheck("I-539A", "2023-01-01")).outcome, "no_explicit_statement");
  nothingWritten(older.store);
});

// ---- the official PDF at its stable uscis.gov address is the source when no page can speak for a form ----
const noPage = async () => ({ ok: false, error: "HTTP 404" });

test("I-130A / I-485 Supplement J (no page of their own): the official PDF at its stable address prints the edition in its footer -> accepted, quoting that footer", async () => {
  for (const [form, edition, footer, file] of [["I-130A", "2024-04-01", "Form I-130A Edition 04/01/24 Page 1 of 6", "i-130a.pdf"], ["I-485J", "2026-09-18", "Form I-485 Sup J Edition 09/18/26 Page 1 of 8", "i-485supj.pdf"]]) {
    const urls = [];
    const pdf = async (url) => { urls.push(url); return url.endsWith(`/${file}`) ? H.pdfFetch()(url) : { ok: false, error: "HTTP 404" }; };
    const { service, store } = build({
      templates: [tpl(form, edition, { importMetadata: { editionDateSource: "pdf" }, lifecycle: {}, officialPdfUrl: undefined })], html: noPage, pdf, resolvePageUrl: pageUrl,
      readPdfTextOf: async () => footer, readPrintedEdition: async () => edition,
    });
    const result = await service.runAutomaticCheck(form, edition);
    assert.equal(result.outcome, "accepted", form);
    assert.equal(result.pattern, "current_official_pdf");
    assert.ok(result.sourceUrl.endsWith(`/${file}`), result.sourceUrl);
    const row = [...store.decisions.values()][0];
    assert.match(row.quote, /Edition \d\d\/\d\d\/\d\d/);
    assert.equal(store.snapshots[0].finalUrl.endsWith(`/${file}`), true);
  }
});

test("the official PDF printing a DIFFERENT edition, or no readable footer, does not accept and writes nothing", async () => {
  const build1 = (text) => build({
    templates: [tpl("I-130A", "2024-04-01", { importMetadata: { editionDateSource: "pdf" }, lifecycle: {} })], html: noPage, resolvePageUrl: pageUrl,
    readPdfTextOf: async () => text, readPrintedEdition: async () => "2024-04-01",
  });
  for (const text of ["Form I-130A Edition 06/01/26 Page 1 of 6", "no footer here", ""]) {
    const { service, store } = build1(text);
    assert.equal((await service.runAutomaticCheck("I-130A", "2024-04-01")).outcome, "official_pdf_edition_differs", JSON.stringify(text));
    nothingWritten(store);
  }
  const unreachable = build({ templates: [tpl("I-130A", "2024-04-01")], html: noPage, pdf: noPage, resolvePageUrl: pageUrl });
  assert.equal((await unreachable.service.runAutomaticCheck("I-130A", "2024-04-01")).outcome, "fetch_failed");
  nothingWritten(unreachable.store);
});
