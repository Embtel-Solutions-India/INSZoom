const assert = require("node:assert/strict");
const test = require("node:test");
const { PDFDocument } = require("pdf-lib");
const { externalFormFor, isExternalFormCode, externalFormCodes, fileNameOf } = require("../config/externalForms");
const Source = require("../services/ExternalFormSource");
const Fingerprint = require("../services/ExternalFormFingerprint");
const Identity = require("../services/FormIdentityService");
const FormMetadataService = require("../services/FormMetadataService");
const Scanner = require("../services/PDFFieldScannerService");
const { runExternalFormsSync } = require("../services/ExternalFormsSyncService");
const { classifyError } = require("../../form-pipeline/errorClassifier");
const { RULES, EXCLUSIVE_FORMS } = require("../../form-mapping/config/partyFieldRules");
const Enforcer = require("../../form-edition-policy/EditionPolicyEnforcer");

// DB-free: the DOL ETA-9089 forms (Appendix A, Final Determination) in the pipeline, and proof that no other form is affected.

const DOL = "https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/";
const APPENDIX = `${DOL}ETA-9089-AppendixA-Expires02-28-29.pdf`;
const FINAL = `${DOL}ETA-9089-Final-Determination-Expires02-28-29.pdf`;
const PAGE = "https://www.dol.gov/agencies/eta/foreign-labor/forms";
const PDF = Buffer.from("%PDF-1.6\n1 0 obj\n<<>>\nendobj\n%%EOF\n");

// a scripted fetch: routes = { url: { status, type, body, location } }
function fakeFetch(routes, calls = []) {
  return async (url, options) => {
    calls.push({ url, ua: options?.headers?.["user-agent"], redirect: options?.redirect, credentials: options?.credentials });
    const route = routes[url];
    if (!route) return { status: 404, headers: new Map(), arrayBuffer: async () => Buffer.alloc(0) };
    const headers = new Map(Object.entries({ "content-type": route.type || "application/pdf", ...(route.location ? { location: route.location } : {}) }));
    return { status: route.status || 200, headers: { get: (key) => headers.get(String(key).toLowerCase()) ?? null }, arrayBuffer: async () => Buffer.from(route.body ?? PDF) };
  };
}
const pageWith = (links) => `<html><body>${links.map(([href, text]) => `<a href="${href}">${text}</a>`).join("\n")}</body></html>`;

test("exactly the two DOL forms are external; every other form code is not", () => {
  assert.deepEqual(externalFormCodes().sort(), ["ETA-9089A", "ETA-9089FD"]);
  assert.equal(isExternalFormCode("eta-9089a "), true);
  assert.equal(isExternalFormCode("ETA-9089FD"), true);
  for (const other of ["I-129", "I-485", "I-9", "ETA-9089", "ETA-9035", "ETA-9141", "ETA-9089B", "I-485J", "G-28", "", undefined]) assert.equal(isExternalFormCode(other), false, String(other));
});

test("the address guard accepts only the official DOL host and directory", () => {
  const entry = externalFormFor("ETA-9089A");
  assert.equal(Source.checkExternalUrl(APPENDIX, entry, "pdf").ok, true);
  assert.equal(Source.checkExternalUrl(PAGE, entry, "html").ok, true);
  const refused = [
    ["http://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/x.pdf", "pdf"], ["https://www.dol.gov.evil.com/sites/dolgov/files/ETA/oflc/pdfs/x.pdf", "pdf"], ["https://evildol.gov/sites/dolgov/files/ETA/oflc/pdfs/x.pdf", "pdf"],
    ["https://www.uscis.gov/sites/dolgov/files/ETA/oflc/pdfs/x.pdf", "pdf"], ["https://user:pw@www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/x.pdf", "pdf"], ["https://1.2.3.4/sites/dolgov/files/ETA/oflc/pdfs/x.pdf", "pdf"],
    ["https://www.dol.gov:8443/sites/dolgov/files/ETA/oflc/pdfs/x.pdf", "pdf"], ["https://www.dol.gov/other/place.pdf", "pdf"], ["https://www.dol.gov/agencies/other", "pdf"], ["https://www.dol.gov/whd/x", "html"], ["not a url", "pdf"],
  ];
  for (const [url, kind] of refused) assert.equal(Source.checkExternalUrl(url, entry, kind).ok, false, url);
});

test("a redirect to another host is refused BEFORE it is requested; one inside dol.gov is followed; cookies are never sent and the User-Agent is the honest one", async () => {
  const entry = externalFormFor("ETA-9089A");
  const calls = [];
  const refused = await Source.fetchExternal(APPENDIX, entry, { kind: "pdf", fetchImpl: fakeFetch({ [APPENDIX]: { status: 302, location: "https://evil.example/x.pdf" } }, calls) });
  assert.equal(refused.ok, false);
  assert.equal(calls.length, 1, "the evil address was never requested");
  const ok = await Source.fetchExternal(APPENDIX, entry, { kind: "pdf", fetchImpl: fakeFetch({ [APPENDIX]: { status: 301, location: `${DOL}moved.pdf` }, [`${DOL}moved.pdf`]: {} }, calls) });
  assert.equal(ok.ok, true);
  assert.ok(calls.every((call) => call.ua === Source.USER_AGENT && call.redirect === "manual" && call.credentials === "omit"));
  assert.ok(!/mozilla|chrome|safari/i.test(Source.USER_AGENT), "no browser impersonation");
});

test("HTTP 403 is reported as blocked, a wrong content type or a non-PDF is refused", async () => {
  const entry = externalFormFor("ETA-9089A");
  const blocked = await Source.fetchExternal(APPENDIX, entry, { kind: "pdf", fetchImpl: fakeFetch({ [APPENDIX]: { status: 403, type: "text/html", body: "<html>denied</html>" } }) });
  assert.deepEqual([blocked.ok, blocked.blocked, blocked.status], [false, true, 403]);
  assert.equal((await Source.fetchExternal(APPENDIX, entry, { kind: "pdf", fetchImpl: fakeFetch({ [APPENDIX]: { type: "text/html", body: "<html></html>" } }) })).ok, false);
  assert.equal((await Source.fetchExternal(APPENDIX, entry, { kind: "pdf", fetchImpl: fakeFetch({ [APPENDIX]: { body: "<HTML>not a pdf</HTML>" } }) })).ok, false);
});

test("way 1 works: the direct address downloads, nothing else is requested", async () => {
  const calls = [];
  const result = await Source.resolveExternalPdf({ formCode: "ETA-9089A", deps: { fetchImpl: fakeFetch({ [APPENDIX]: {} }, calls) } });
  assert.deepEqual([result.ok, result.via, result.pdfUrl], [true, "direct", APPENDIX]);
  assert.equal(calls.length, 1);
});

test("a direct 403 falls to way 2: the forms page's CURRENT link (also after DOL renews the file name); the Professional Athletes Appendix A link is never used", async () => {
  const athletes = `${DOL}Form%20ETA-9089%20-%20Appendix%20A%20-%20508%20Compliant%20-%2006.01.2023.pdf`;
  const renewed = `${DOL}ETA-9089-AppendixA-Expires02-28-32.pdf`;
  const calls = [];
  const html = pageWith([[athletes, "Form ETA-9089, Appendix A"], [FINAL.replace(DOL, "/sites/dolgov/files/ETA/oflc/pdfs/"), "Form ETA-9089, Final Determination"], [renewed.replace(DOL, "/sites/dolgov/files/ETA/oflc/pdfs/"), "Form ETA-9089, Appendix A"]]);
  const result = await Source.resolveExternalPdf({ formCode: "ETA-9089A", deps: { fetchImpl: fakeFetch({ [APPENDIX]: { status: 403, type: "text/html" }, [PAGE]: { type: "text/html", body: html }, [renewed]: {}, [athletes]: {} }, calls) } });
  assert.deepEqual([result.ok, result.via, result.pdfUrl], [true, "forms_page", renewed]);
  assert.ok(!calls.some((call) => call.url === athletes), "the athletes file was never requested");
  assert.ok(!calls.some((call) => call.url === FINAL), "the other DOL form was never requested");
  assert.equal(result.tried[0].route, "direct");
});

test("both ways refused: the result is a precise, retry-slowly 'blocked' error that names the upload fallback", async () => {
  const result = await Source.resolveExternalPdf({ formCode: "ETA-9089FD", deps: { fetchImpl: fakeFetch({ [FINAL]: { status: 403, type: "text/html" }, [PAGE]: { status: 403, type: "text/html" } }) } });
  assert.equal(result.ok, false);
  assert.equal(result.blocked, true);
  assert.equal(result.code, "EXTERNAL_SOURCE_BLOCKED");
  assert.match(result.error, /upload/i);
  assert.equal(classifyError(Object.assign(new Error(result.error), { code: result.code, status: 403 })).class, "blocked");
  const none = await Source.resolveExternalPdf({ formCode: "ETA-9089FD", deps: { fetchImpl: fakeFetch({ [FINAL]: { status: 404, type: "text/html" }, [PAGE]: { type: "text/html", body: pageWith([]) } }) } });
  assert.equal(none.code, "EXTERNAL_SOURCE_UNRESOLVED");
});

test("a stored address is tried first, but only when it is an official file of THIS form", async () => {
  const stored = `${DOL}ETA-9089-AppendixA-Expires02-28-31.pdf`;
  const calls = [];
  const result = await Source.resolveExternalPdf({ formCode: "ETA-9089A", template: { officialPdfUrl: stored }, deps: { fetchImpl: fakeFetch({ [stored]: {} }, calls) } });
  assert.equal(result.pdfUrl, stored);
  assert.equal(calls[0].url, stored);
  const wrong = await Source.resolveExternalPdf({ formCode: "ETA-9089A", template: { officialPdfUrl: FINAL }, deps: { fetchImpl: fakeFetch({ [APPENDIX]: {} }, (calls.length = 0, calls)) } });
  assert.equal(wrong.pdfUrl, APPENDIX);
  assert.ok(!calls.some((call) => call.url === FINAL));
});

test("file-name matching separates the two forms and the athletes file", () => {
  assert.equal(fileNameOf(APPENDIX), "ETA-9089-AppendixA-Expires02-28-29");
  assert.ok(externalFormFor("ETA-9089A").filePrefix.test(fileNameOf(APPENDIX)));
  assert.ok(!externalFormFor("ETA-9089A").filePrefix.test(fileNameOf(FINAL)));
  assert.ok(!externalFormFor("ETA-9089FD").filePrefix.test(fileNameOf(APPENDIX)));
  assert.ok(!externalFormFor("ETA-9089A").filePrefix.test(fileNameOf(`${DOL}Form%20ETA-9089%20-%20Appendix%20A%20-%20508%20Compliant%20-%2006.01.2023.pdf`)));
});

test("version by content: same content re-saved is NOT a new version; any real change is", () => {
  const base = { sha256: "a", pageCount: 5, fields: [{ type: "PDFTextField", name: "Last  Name" }, { type: "PDFCheckBox", name: "Box" }], text: "OMB Approval: 1205-0451 Expiration Date:02/28/2029 Application for Permanent Employment Certification" };
  const first = Fingerprint.fromParts(base);
  assert.equal(first.ombExpiration, "2029-02-28");
  assert.deepEqual(Fingerprint.compare(first, first), { same: true, sameContent: true, reason: "identical" });
  const resaved = Fingerprint.fromParts({ ...base, sha256: "b", text: base.text.replace(/ /g, "  \n") });
  assert.equal(Fingerprint.compare(first, resaved).reason, "identical_reissue");
  assert.equal(Fingerprint.compare(first, Fingerprint.fromParts({ ...base, sha256: "c", text: `${base.text} one new question` })).reason, "text_changed");
  assert.equal(Fingerprint.compare(first, Fingerprint.fromParts({ ...base, sha256: "d", fields: [...base.fields, { type: "PDFTextField", name: "New box" }] })).reason, "fields_changed");
  assert.equal(Fingerprint.compare(first, Fingerprint.fromParts({ ...base, sha256: "e", pageCount: 6 })).reason, "pages_changed");
  assert.equal(Fingerprint.compare(null, first).reason, "no_baseline");
  assert.equal(Fingerprint.fromParts({ ...base, text: "no date here" }).ombExpiration, null);
});

test("a real PDF round trip: the same form saved again is an identical re-issue", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  doc.getForm().createTextField("Employer Name").addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
  const bytes = Buffer.from(await doc.save());
  const again = Buffer.from(await (await PDFDocument.load(bytes)).save({ useObjectStreams: false }));
  const deps = { normalize: async (b) => b, readText: async () => "Form ETA-9089 Appendix A" };
  const a = await Fingerprint.fingerprintOf(bytes, deps);
  const b = await Fingerprint.fingerprintOf(again, deps);
  assert.equal(a.fieldCount, 1);
  assert.equal(a.pageCount, 1);
  assert.notEqual(a.sha256, b.sha256);
  assert.equal(Fingerprint.compare(a, b).reason, "identical_reissue");
});

test("identity: the two DOL footers share 'Form ETA-9089', so the TITLE decides, and a wrong file is refused", () => {
  const appendix = externalFormFor("ETA-9089A");
  const final = externalFormFor("ETA-9089FD");
  assert.deepEqual(Identity.judgeExternal(["Form ETA-9089 - Appendix A FOR DEPARTMENT OF LABOR USE ONLY Page A.1 of A.5"], appendix), { ok: true });
  assert.equal(Identity.judgeExternal(["Form ETA-9089 - Appendix A Page A.1 of A.5"], final).ok, false);
  assert.equal(Identity.judgeExternal(["Form ETA-9089 - Final Determination Page 1 of 2"], appendix).ok, false);
  assert.equal(Identity.judgeExternal(["Form ETA-9089 - Final Determination Page 1 of 2"], final).ok, true);
  assert.equal(Identity.judgeExternal(["no footer text"], appendix).inconclusive, true);
  // USCIS forms keep the number-based judgement
  assert.equal(Identity.judge(Identity.footerNumbers(["Form I-130 Edition 04/01/24", "Form I-130 Edition 04/01/24"]), "I-129").ok, false);
});

test("metadata: the detection day is the edition ONLY when nothing printed or published exists; nothing changes for any other form", () => {
  const detected = new Date("2026-11-07T10:00:00Z");
  const external = FormMetadataService.resolveEdition({ detected, inputVersion: "v1" });
  assert.equal(external.editionDateSource, "import_date");
  assert.equal(external.editionDate.toISOString(), detected.toISOString());
  assert.equal(external.version, "v1");
  const printed = new Date("2025-01-20T00:00:00Z");
  assert.equal(FormMetadataService.resolveEdition({ printed, detected }).editionDateSource, "pdf");
  assert.equal(FormMetadataService.resolveEdition({ page: printed, detected }).editionDateSource, "uscis_page");
  const none = FormMetadataService.resolveEdition({});
  assert.equal(none.editionDate, undefined);
  assert.equal(none.editionDateSource, "import_date");
  // the OMB "Expiration Date" line of the DOL forms is never read as an edition
  assert.equal(FormMetadataService.extractEditionDate("OMB Approval: 1205-0451 Expiration Date:02/28/2029 Form ETA-9089 - Appendix A Page A.1 of A.5"), undefined);
});

test("scanner: a type override fixes only the named boxes; without options the scan is exactly as before", async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  form.createTextField("1c  Name of Institution that issued the degreediploma").addToPage(page, { x: 10, y: 10, width: 100, height: 20 });
  form.createTextField("Date of Birth").addToPage(page, { x: 10, y: 40, width: 100, height: 20 });
  const bytes = Buffer.from(await doc.save());
  const scanner = typeof Scanner === "function" ? new Scanner() : Scanner;
  const plain = await scanner.scan(bytes);
  assert.equal(plain.fields.find((f) => /issued/.test(f.pdfFieldName)).type, "date", "the generic guess misreads it");
  const fixed = await scanner.scan(bytes, { typeOverrides: externalFormFor("ETA-9089A").fieldTypeOverrides });
  assert.equal(fixed.fields.find((f) => /issued/.test(f.pdfFieldName)).type, "text");
  assert.equal(fixed.fields.find((f) => /Date of Birth/.test(f.pdfFieldName)).type, "date", "an untouched box keeps its type");
  assert.equal(fixed.fields.length, plain.fields.length);
});

test("canonical rules: authored, EXCLUSIVE, no duplicate stems, no signature / DOL-issued box mapped", () => {
  for (const code of ["ETA-9089A", "ETA-9089FD"]) {
    assert.ok(EXCLUSIVE_FORMS.has(code), `${code} is exclusive`);
    const stems = RULES[code].flatMap((rule) => rule.stems.map((stem) => stem.toLowerCase()));
    assert.equal(new Set(stems).size, stems.length, `${code}: no stem is used twice`);
    for (const rule of RULES[code]) {
      assert.match(rule.to, /^(beneficiary|petitioner)\./);
      assert.ok(!rule.stems.some((stem) => /signature|date signed|initial|case number|case status|determination date|filing date|expiration date/i.test(stem)), `${code}: ${rule.stems} must stay unmapped`);
    }
  }
  assert.ok(RULES["ETA-9089A"].some((rule) => rule.to === "beneficiary.lastName"));
  assert.ok(RULES["ETA-9089FD"].some((rule) => rule.to === "petitioner.ein"));
});

test("the edition gate accepts a DOL edition fetched from the official source - and only that", async () => {
  const day = new Date("2026-11-07T00:00:00Z");
  const held = { findDecision: async () => null };
  const calls = [];
  const deps = (store) => ({ service: { runAutomaticCheck: async () => { calls.push("evidence"); throw new Error("no USCIS page for a DOL form"); }, recordOutcome: async () => {} }, store, autoEvidence: true });
  const dol = { formCode: "ETA-9089A", editionDate: day, importMetadata: { editionDateSource: "import_date" } };
  try {
    Enforcer.setDepsForTests(deps(held));
    const allowed = await Enforcer.requireAcceptedEdition(dol, { entryPoint: "test" });
    assert.equal(allowed.allowed, true);
    assert.equal(allowed.ownerPolicy, "official_external_source");
    assert.deepEqual(calls, [], "no USCIS evidence was requested for a DOL form");
    assert.equal((await Enforcer.peekAcceptance(dol)).allowed, true);
    // a USCIS form with the same kind of edition date is still held (the rule never applies to it)
    await assert.rejects(() => Enforcer.requireAcceptedEdition({ formCode: "I-485", editionDate: day, importMetadata: { editionDateSource: "import_date" } }, { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" });
    // a DOL form whose edition date did not come from detection is held
    await assert.rejects(() => Enforcer.requireAcceptedEdition({ ...dol, importMetadata: { editionDateSource: "pdf" } }, { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" });
    // a recorded "not accepted" decision always wins
    Enforcer.setDepsForTests(deps({ findDecision: async () => ({ decision: "not_accepted", status: "verified" }) }));
    await assert.rejects(() => Enforcer.requireAcceptedEdition(dol, { entryPoint: "test" }), { code: "EDITION_POLICY_HELD" });
  } finally {
    Enforcer.setDepsForTests(null);
  }
});

test("the 12-hourly external step runs each form on its own: one failing never stops the other, and it is switchable", async () => {
  const seen = [];
  const runForm = async ({ formCode }) => {
    seen.push(formCode);
    if (formCode === "ETA-9089A") throw new Error("DOL unreachable");
    return { template: { status: "active" }, versionChanged: true, requiresActivation: false };
  };
  const out = await runExternalFormsSync({ deps: { runForm } });
  assert.deepEqual(seen.sort(), ["ETA-9089A", "ETA-9089FD"]);
  assert.deepEqual(out.results.map((item) => `${item.formCode}:${item.outcome}`).sort(), ["ETA-9089A:error", "ETA-9089FD:new_version_live"]);
  const kept = await runExternalFormsSync({ deps: { runForm: async () => ({ template: { status: "active" }, alreadyActive: true, checkError: "refused (HTTP 403)" }) } });
  assert.ok(kept.results.every((item) => item.outcome === "source_unreachable"));
  // a first import / a resumed copy that goes live (the activation result has alreadyActive: false and no versionChanged) is reported as a new live version, a held one as kept_in_review
  const first = await runExternalFormsSync({ deps: { runForm: async ({ formCode }) => (formCode === "ETA-9089A" ? { template: { status: "active" }, alreadyActive: false, requiresActivation: false } : { template: { status: "review" }, alreadyActive: false, requiresActivation: true, activationBlockedReason: "held" }) } });
  assert.deepEqual(first.results.map((item) => `${item.formCode}:${item.outcome}`).sort(), ["ETA-9089A:new_version_live", "ETA-9089FD:kept_in_review"]);
  const only = await runExternalFormsSync({ only: ["ETA-9089FD"], deps: { runForm: async () => ({ alreadyActive: true }) } });
  assert.deepEqual(only.results.map((item) => item.formCode), ["ETA-9089FD"]);
  process.env.EXTERNAL_FORMS_SYNC = "false";
  try { assert.deepEqual(await runExternalFormsSync({ deps: { runForm: async () => { throw new Error("must not run"); } } }), { enabled: false, checked: 0, results: [] }); } finally { delete process.env.EXTERNAL_FORMS_SYNC; }
});

test("pipeline error classes: the new codes retry slowly; every existing classification is unchanged", () => {
  for (const code of ["EXTERNAL_SOURCE_BLOCKED", "EXTERNAL_SOURCE_UNRESOLVED", "PDF_UNREADABLE"]) assert.equal(classifyError(Object.assign(new Error("x"), { code })).class, "blocked");
  assert.equal(classifyError(Object.assign(new Error("x"), { status: 403 })).class, "transient");
  assert.equal(classifyError(Object.assign(new Error("x"), { code: "FORM_PDF_MISMATCH" })).class, "blocked");
  assert.equal(classifyError(Object.assign(new Error("x"), { code: "EDITION_POLICY_HELD" })).class, "held");
});

// ---- error handling through code: every error of these forms has a linked, verified solution --------------------------------------------------------------------------------------------
const { loadCatalog } = require("../../form-pipeline/resolution/catalog");
const { diagnose } = require("../../form-pipeline/resolution/Diagnoser");
const { createResolver } = require("../../form-pipeline/resolution/Resolver");

test("a refused / unlisted DOL source is diagnosed as source_not_found and linked to the DOL catalog entry (never the uscis.gov one); an ordinary 403 is not captured", () => {
  const catalog = loadCatalog();
  assert.ok(catalog.some((entry) => entry.id === "external_source"));
  for (const code of ["EXTERNAL_SOURCE_BLOCKED", "EXTERNAL_SOURCE_UNRESOLVED"]) {
    const error = Object.assign(new Error("refused"), { code, status: 403 });
    const diagnosis = diagnose({ error, stage: "detect", job: { formCode: "ETA-9089A" } });
    assert.equal(diagnosis.cause, "source_not_found");
    const ctx = { formCode: "ETA-9089A", job: { formCode: "ETA-9089A" } };
    const matching = catalog.filter((entry) => entry.matches(diagnosis, error, ctx)).map((entry) => entry.id);
    assert.deepEqual(matching.filter((id) => id !== "generic"), ["external_source"]);
  }
  const uscis404 = Object.assign(new Error("page fetch failed: 404"), { status: 404 });
  const d = diagnose({ error: uscis404, stage: "detect", job: { formCode: "I-485J" } });
  assert.ok(catalog.find((entry) => entry.id === "source_not_found").matches(d, uscis404, { formCode: "I-485J" }), "the USCIS entry still handles USCIS forms");
  assert.equal(catalog.find((entry) => entry.id === "external_source").matches(d, uscis404, { formCode: "I-485J" }), false);
});

test("the DOL solutions run each way on its own: a verified success asks the engine to retry the job, nothing working is an honest 'exhausted'", async () => {
  const catalog = loadCatalog().filter((entry) => entry.id === "external_source");
  const error = Object.assign(new Error("refused by every route"), { code: "EXTERNAL_SOURCE_BLOCKED", status: 403 });
  const resolver = createResolver({ catalog, store: null, log: { info() {}, warn() {} } });
  const run = (fetchImpl) => resolver.resolve({ error, stage: "detect", job: { formCode: "ETA-9089A" }, ctx: { deps: { fetchImpl } } });
  // way 1 refused (403), way 2 (the page's current link, after a renewal renamed the file) works
  const renewed = `${DOL}ETA-9089-AppendixA-Expires02-28-32.pdf`;
  const page = pageWith([[renewed.replace(DOL, "/sites/dolgov/files/ETA/oflc/pdfs/"), "Form ETA-9089, Appendix A"]]);
  const solved = await run(fakeFetch({ [APPENDIX]: { status: 403, type: "text/html" }, [PAGE]: { type: "text/html", body: page }, [renewed]: {} }));
  assert.equal(solved.outcome, "resolved");
  assert.equal(solved.retry, true);
  assert.deepEqual(solved.attempts.map((attempt) => [attempt.strategy, attempt.ok]), [["direct_address", false], ["forms_page_current_link", true]]);
  assert.equal(solved.attempts[1].verified, true);
  // way 1 works at once (the refusal was a passing blip)
  const blip = await run(fakeFetch({ [APPENDIX]: {} }));
  assert.equal(blip.outcome, "resolved");
  assert.equal(blip.attempts[0].strategy, "direct_address");
  // both refused: exhausted, with the evidence of each way
  const none = await run(fakeFetch({ [APPENDIX]: { status: 403, type: "text/html" }, [PAGE]: { status: 403, type: "text/html" } }));
  assert.equal(none.outcome, "exhausted");
  assert.equal(none.retry, false);
  assert.ok(none.attempts.every((attempt) => attempt.ok === false && /403|refused/.test(attempt.evidence)));
});

// ---- acquisition: resume a half-finished import, never duplicate, and the version stamp survives activation ----------------------------------------------------------------------------
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const { ensureCurrentExternalForm } = require("../services/ExternalFormAcquisitionService");

function stubModel(state) {
  const original = {};
  const set = (name, fn) => { original[name] = USCISFormTemplate[name]; USCISFormTemplate[name] = fn; };
  set("findOne", () => ({ sort: async () => state.pending || null }));
  set("findById", async (id) => state.docs[String(id)] || null);
  set("exists", async () => (state.stampSurvives ? { _id: 1 } : null));
  set("updateOne", async (filter, update) => { state.updates.push(update.$set); return {}; });
  set("countDocuments", async () => state.count || 0);
  return () => Object.entries(original).forEach(([name, fn]) => { USCISFormTemplate[name] = fn; });
}
const fp = Fingerprint.fromParts({ sha256: "s1", pageCount: 5, fields: [{ type: "PDFTextField", name: "A" }], text: "Form ETA-9089 Appendix A" });
const baseHelpers = (calls, extra = {}) => ({
  importer: { importFromBuffer: async (bytes, input) => { calls.imports.push(input); return { template: { _id: "new1", version: input.version }, comparisonReport: null }; } },
  findLatestActiveTemplate: async () => null,
  activateOrPromote: async (template) => { calls.activations.push(template); return { template: { ...template, status: "review" }, requiresActivation: true }; },
  recordEdition: async () => {},
  registerBrandNewFormUnlinked: async () => false,
  compactActivationReport: () => ({}),
  enterpriseError: (message, status, code) => Object.assign(new Error(message), { status, code }),
  retryUntilSuccess: (fn) => fn(),
  resolveExternalPdf: async () => ({ ok: true, via: "direct", pdfUrl: APPENDIX, pageUrl: PAGE, bytes: PDF, tried: [] }),
  fingerprintOf: async () => fp,
  ...extra,
});

test("a copy of this file that was imported but never went live is RESUMED (no second import) and its stamp is written", async () => {
  const pending = { _id: "pend1", formCode: "ETA-9089A", version: "v1", status: "review", importMetadata: { checksum: "s1" }, lifecycle: {}, createdAt: new Date("2026-11-06") };
  const state = { pending, docs: { pend1: pending }, updates: [], stampSurvives: false };
  const calls = { imports: [], activations: [] };
  const restore = stubModel(state);
  try {
    const out = await ensureCurrentExternalForm({ formCode: "ETA-9089A", entry: externalFormFor("ETA-9089A"), user: {}, req: {}, options: { forceCheck: true }, helpers: baseHelpers(calls) });
    assert.equal(calls.imports.length, 0, "nothing is imported twice");
    assert.equal(calls.activations.length, 1);
    assert.equal(calls.activations[0]._id, "pend1");
    assert.equal(out.resumedPending, true);
    const stamp = state.updates.find((update) => update["lifecycle.external.internalVersion"]);
    assert.equal(stamp["lifecycle.external.internalVersion"], "ETA-9089-APPENDIX-A-v1");
    assert.equal(stamp["lifecycle.external.fingerprint"].content, fp.content);
  } finally { restore(); }
});

test("a first import is v1, goes to the shared activation with the CURRENT template, and the stamp is re-written if activation dropped it", async () => {
  const state = { pending: null, docs: { new1: { _id: "new1", version: "v1", lifecycle: { external: {} } } }, updates: [], stampSurvives: false, count: 0 };
  const calls = { imports: [], activations: [] };
  const restore = stubModel(state);
  try {
    const out = await ensureCurrentExternalForm({ formCode: "ETA-9089A", entry: externalFormFor("ETA-9089A"), user: {}, req: {}, options: { forceCheck: true }, helpers: baseHelpers(calls) });
    assert.equal(calls.imports.length, 1);
    assert.equal(calls.imports[0].version, "v1");
    assert.equal(calls.imports[0].provider, "dol");
    assert.ok(calls.imports[0].detectedEditionAt instanceof Date);
    assert.equal(out.alreadyActive, false);
    assert.ok(calls.activations[0] === state.docs.new1, "activation received the freshly loaded template");
    const stamps = state.updates.filter((update) => update["lifecycle.external.fingerprint"]);
    assert.ok(stamps.length >= 2, "stamped at import and again after activation dropped it");
  } finally { restore(); }
});

test("a refused source with nothing live is a thrown, classified error; with a live edition it is returned as a check error and the edition keeps serving", async () => {
  const failing = { resolveExternalPdf: async () => ({ ok: false, blocked: true, code: "EXTERNAL_SOURCE_BLOCKED", error: "refused (HTTP 403) - upload the PDF", tried: [{ route: "direct", status: 403, note: "x" }] }) };
  const state = { pending: null, docs: {}, updates: [] };
  const restore = stubModel(state);
  try {
    await assert.rejects(() => ensureCurrentExternalForm({ formCode: "ETA-9089A", entry: externalFormFor("ETA-9089A"), user: {}, req: {}, options: { forceCheck: true }, helpers: baseHelpers({ imports: [], activations: [] }, failing) }), { code: "EXTERNAL_SOURCE_BLOCKED", status: 403 });
    const live = { _id: "live1", status: "active", lifecycle: {} };
    const kept = await ensureCurrentExternalForm({ formCode: "ETA-9089A", entry: externalFormFor("ETA-9089A"), user: {}, req: {}, options: { forceCheck: true }, helpers: baseHelpers({ imports: [], activations: [] }, { ...failing, findLatestActiveTemplate: async () => live }) });
    assert.equal(kept.template, live);
    assert.equal(kept.alreadyActive, true);
    assert.equal(kept.sourceBlocked, true);
    assert.match(kept.checkError, /refused/);
  } finally { restore(); }
});

// ---- the font size of the text Immiglance writes: only these two forms, only their auto-size boxes ----------------------------------------------------------------------------------------
const { applyAutoFontSize } = require("../../form-generation/services/AutoFontSizeGuard");

test("DOL forms: auto-size boxes get the form's fixed size (12 pt); a box with its own size keeps it; every other form is untouched", async () => {
  const build = async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage();
    const form = doc.getForm();
    const auto = form.createTextField("Employer");
    auto.addToPage(page, { x: 10, y: 10, width: 200, height: 21 });
    auto.acroField.setDefaultAppearance("/Helv 0 Tf 0 g");
    const fixed = form.createTextField("Fixed");
    fixed.addToPage(page, { x: 10, y: 50, width: 200, height: 21 });
    fixed.acroField.setDefaultAppearance("/Helv 9 Tf 0 g");
    return { form, auto, fixed };
  };
  const dol = await build();
  assert.equal(applyAutoFontSize(dol.form, "ETA-9089FD"), 1);
  assert.match(dol.auto.acroField.getDefaultAppearance(), /\b12 Tf/);
  assert.match(dol.fixed.acroField.getDefaultAppearance(), /\b9 Tf/);
  for (const code of ["I-129", "I-485", "I-9", "ETA-9089", "ETA-9035", undefined]) {
    const other = await build();
    assert.equal(applyAutoFontSize(other.form, code), 0, String(code));
    assert.match(other.auto.acroField.getDefaultAppearance(), /\b0 Tf/, `${code}: the auto size is left exactly as it was`);
  }
  assert.equal(applyAutoFontSize(null, "ETA-9089A"), 0, "a broken form never throws");
  assert.equal(externalFormFor("ETA-9089A").fontSizePt, 12);
  assert.equal(externalFormFor("ETA-9089FD").fontSizePt, 12);
});

// ---- future versions: a renamed box is reported, never a silent gap -------------------------------------------------------------------------------------------------------------------------
const { unmatchedFor } = require("../services/ExternalFormHealth");

test("a future version of a DOL form: matching boxes are healthy; a renamed box is named precisely; every other form is out of scope", () => {
  const rules = RULES["ETA-9089FD"];
  const boxes = rules.flatMap((rule) => rule.stems).map((stem) => ({ pdfFieldName: stem }));
  assert.deepEqual(unmatchedFor({ formCode: "ETA-9089FD", fields: boxes }), { unmatchedRuleStems: [], unmatchedTypeOverrides: [] });
  const renamed = boxes.map((box) => (box.pdfFieldName === "8  Job Title" ? { pdfFieldName: "8  Position Title" } : box));
  assert.deepEqual(unmatchedFor({ formCode: "ETA-9089FD", fields: renamed }).unmatchedRuleStems, ["8  Job Title"]);
  const appendix = RULES["ETA-9089A"].flatMap((rule) => rule.stems).map((stem) => ({ pdfFieldName: stem }));
  const result = unmatchedFor({ formCode: "ETA-9089A", fields: appendix });
  assert.deepEqual(result.unmatchedRuleStems, []);
  assert.equal(result.unmatchedTypeOverrides.length, 1, "the 'issued the degree' override has no box in this fixture (only the apartment one does)");
  assert.deepEqual(unmatchedFor({ formCode: "I-129", fields: [] }), { unmatchedRuleStems: [], unmatchedTypeOverrides: [] });
  // the size and the hidden internal label belong to the FORM, so they apply to every later version unchanged
  assert.equal(externalFormFor("ETA-9089FD").fontSizePt, 12);
});

// ---- the hook lives in FullTextFieldGuard (both renderers call it); PDFRenderer.js must stay untouched -------------------------------------------------------------------------------------
const { shrinkLongTextToFit } = require("../../form-generation/services/FullTextFieldGuard");
const { identifyExternalForm } = require("../../form-generation/services/AutoFontSizeGuard");

async function pdfWithBoxes(names) {
  const doc = await PDFDocument.create();
  const page = doc.addPage();
  const form = doc.getForm();
  const fields = names.map((name, index) => {
    const field = form.createTextField(name);
    field.addToPage(page, { x: 10, y: 10 + index * 30, width: 300, height: 21 });
    field.acroField.setDefaultAppearance("/Helv 0 Tf 0 g");
    return field;
  });
  return { doc, form, fields };
}

test("the existing shrink step sets the 12 pt size on a DOL form recognised by its own boxes, and on nothing else", async () => {
  const fd = await pdfWithBoxes(RULES["ETA-9089FD"].flatMap((rule) => rule.stems));
  assert.equal(identifyExternalForm(fd.form), "ETA-9089FD");
  fd.fields[0].setText("NEXTDAY SOLUTIONS INC.");
  await shrinkLongTextToFit(fd.doc, fd.form);
  assert.ok(fd.fields.every((field) => /\b12 Tf/.test(field.acroField.getDefaultAppearance())), "every auto box of the DOL form is 12 pt, filled or empty");

  const appendix = await pdfWithBoxes(RULES["ETA-9089A"].flatMap((rule) => rule.stems));
  assert.equal(identifyExternalForm(appendix.form), "ETA-9089A");

  // a later version that renamed a box is still recognised (at least half of the rule stems present)
  const renamed = await pdfWithBoxes([...RULES["ETA-9089FD"].flatMap((rule) => rule.stems).slice(0, 5), "8  Position Title", "9  Occupation Code"]);
  assert.equal(identifyExternalForm(renamed.form), "ETA-9089FD");

  const uscis = await pdfWithBoxes(["Part1_Line2a_FamilyName", "Part1_Line2b_GivenName", "Line3_CompanyorOrgName"]);
  assert.equal(identifyExternalForm(uscis.form), null);
  uscis.fields[0].setText("Smith");
  await shrinkLongTextToFit(uscis.doc, uscis.form);
  assert.ok(uscis.fields.every((field) => /\b0 Tf/.test(field.acroField.getDefaultAppearance())), "a USCIS form keeps its auto size exactly as before");
  assert.equal(identifyExternalForm({ getFields() { throw new Error("broken"); } }), null, "a broken form never throws");
});

test("deploy constraint: PDFRenderer.js is not edited for the DOL forms (the production server keeps a local change to it, so any commit touching it aborts the server's git pull)", () => {
  const source = require("node:fs").readFileSync(require.resolve("../../form-generation/services/PDFRenderer.js"), "utf8");
  assert.ok(!/AutoFontSizeGuard|applyAutoFontSize|externalForms/.test(source));
});
