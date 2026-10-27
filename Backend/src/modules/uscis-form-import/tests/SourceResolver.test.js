// Phase 7.E source resolver: no network (an injected fetch plays uscis.gov), no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveSource, rememberSource, describeForm } = require("../services/SourceResolver");
const { pageUrlFor, aliasFor } = require("../config/formSourceAliases");

const BASE = "https://www.uscis.gov";
const PDF = (slug) => `${BASE}/sites/default/files/document/forms/${slug}.pdf`;
const page = (title, links = []) => `<html><body><h1>${title}</h1>${links.map((href) => `<a href="${href}">${href.split("/").pop()}</a>`).join("")}</body></html>`;

/** a tiny uscis.gov: url -> { html } | { pdf: true }; anything else is a 404. Records every request (GET only, official hosts only). */
function fakeSite(pages = {}) {
  const requests = [];
  const fetch = async (url, { accept = "html" } = {}) => {
    requests.push({ url, accept });
    const entry = pages[url];
    if (!entry) return { ok: false, status: 404, error: "HTTP 404", violations: [] };
    if (entry.pdf) {
      if (accept !== "pdf") return { ok: false, status: 200, error: "content type application/pdf is not accepted here" };
      return { ok: true, status: 200, finalUrl: url, contentType: "application/pdf", bytes: Buffer.from("%PDF-1.7 fake") };
    }
    if (accept !== "html") return { ok: false, status: 200, error: "content type text/html is not accepted here" };
    return { ok: true, status: 200, finalUrl: url, contentType: "text/html", bytes: Buffer.from(entry.html) };
  };
  return { fetch, requests };
}

const realSite = () => fakeSite({
  [`${BASE}/i-485supj`]: { html: page("Form I-485 Supplement J, Confirmation of Bona Fide Job Offer", ["/sites/default/files/document/forms/i-485supj.pdf", "/sites/default/files/document/forms/i-485supj-instructions.pdf"]) },
  [PDF("i-485supj")]: { pdf: true },
  [`${BASE}/i-539`]: { html: page("Form I-539, Application to Extend/Change Nonimmigrant Status", ["/sites/default/files/document/forms/i-539.pdf", "/sites/default/files/document/forms/i-539a.pdf"]) },
  [PDF("i-539")]: { pdf: true },
  [PDF("i-539a")]: { pdf: true },
  [`${BASE}/i-130`]: { html: page("Form I-130", ["/sites/default/files/document/forms/i-130.pdf", "/sites/default/files/document/forms/i-130a.pdf"]) },
  [PDF("i-130a")]: { pdf: true },
});

test("I-485J resolves to its real page /i-485supj and PDF (the code-derived /i-485j is a 404)", async () => {
  const site = realSite();
  const found = await resolveSource({ formCode: "I-485J", deps: { fetch: site.fetch, directory: async () => [] } });
  assert.equal(found.ok, true);
  assert.equal(found.via, "alias");
  assert.equal(found.pageUrl, `${BASE}/i-485supj`);
  assert.equal(found.pdfUrl, PDF("i-485supj"));
  assert.match(found.instructionsUrl, /i-485supj-instructions\.pdf$/);
});

test("I-539A has no page of its own: it resolves through the parent page /i-539 to /forms/i-539a.pdf", async () => {
  const site = realSite();
  const found = await resolveSource({ formCode: "I-539A", deps: { fetch: site.fetch, directory: async () => [] } });
  assert.equal(found.ok, true);
  assert.equal(found.via, "parent_page");
  assert.equal(found.pageUrl, `${BASE}/i-539`);
  assert.equal(found.pdfUrl, PDF("i-539a"));
  assert.ok(found.tried.some((item) => item.url === `${BASE}/i-539a` && item.status === 404), "the wrong address is recorded as tried");
});

test("the stable PDF address works when no page names the form", async () => {
  const site = fakeSite({ [PDF("i-130a")]: { pdf: true } });
  const found = await resolveSource({ formCode: "I-130A", deps: { fetch: site.fetch, directory: async () => [] } });
  assert.deepEqual([found.ok, found.via, found.pdfUrl], [true, "stable_pdf", PDF("i-130a")]);
});

test("a stored, still-valid address wins and nothing else is requested", async () => {
  const site = realSite();
  const template = { _id: "t1", officialPdfUrl: PDF("i-485supj"), lifecycle: { sourcePageUrl: `${BASE}/i-485supj` } };
  const found = await resolveSource({ formCode: "I-485J", template, deps: { fetch: site.fetch } });
  assert.deepEqual([found.ok, found.via, found.pdfUrl], [true, "stored", PDF("i-485supj")]);
  assert.equal(site.requests.length, 1);
});

test("a stored address that has gone stale falls through to the alias", async () => {
  const site = realSite();
  const template = { _id: "t1", officialPdfUrl: PDF("i-485j-old") };
  const found = await resolveSource({ formCode: "I-485J", template, deps: { fetch: site.fetch, directory: async () => [] } });
  assert.deepEqual([found.ok, found.via], [true, "alias"]);
  assert.equal(found.tried[0].status, 404);
});

test("when every candidate fails the result lists every address tried, and never throws", async () => {
  const site = fakeSite({});
  const found = await resolveSource({ formCode: "I-485J", deps: { fetch: site.fetch, directory: async () => [] } });
  assert.equal(found.ok, false);
  assert.ok(found.tried.length >= 5);
  assert.ok(found.tried.every((item) => item.url && item.status === 404));
  const throwing = await resolveSource({ formCode: "I-485J", deps: { fetch: async () => { throw new Error("boom"); }, directory: async () => { throw new Error("dir"); } } });
  assert.equal(throwing.ok, false);
});

test("a page that neither names the form nor links its PDF is not accepted", async () => {
  const site = fakeSite({ [`${BASE}/i-485supj`]: { html: page("Some other form", ["/sites/default/files/document/forms/other.pdf"]) } });
  const found = await resolveSource({ formCode: "I-485J", deps: { fetch: site.fetch, directory: async () => [] } });
  assert.equal(found.ok, false);
  assert.ok(found.tried.some((item) => /does not name or link/.test(item.note)));
});

test("a PDF address that answers with something that is not a PDF is rejected", async () => {
  const fetch = async (url, { accept }) => (accept === "pdf" ? { ok: true, status: 200, finalUrl: url, bytes: Buffer.from("<html>soft 404</html>") } : { ok: false, status: 404 });
  const found = await resolveSource({ formCode: "I-130A", deps: { fetch, directory: async () => [] } });
  assert.equal(found.ok, false);
  assert.ok(found.tried.some((item) => item.note === "not a PDF"));
});

test("a non-uscis.gov address is never requested", async () => {
  const site = realSite();
  const found = await resolveSource({ formCode: "I-485J", template: { officialPdfUrl: "https://evil.example.com/i-485supj.pdf" }, deps: { fetch: site.fetch, directory: async () => [] } });
  assert.equal(found.ok, true);
  assert.ok(site.requests.every((request) => request.url.startsWith("https://www.uscis.gov/")));
  assert.ok(found.tried.some((item) => /not an official/.test(item.note)));
});

test("the directory entry is the last resort", async () => {
  const site = fakeSite({ [PDF("i-485supj-old-name")]: { pdf: true } });
  const found = await resolveSource({ formCode: "I-485J", deps: { fetch: site.fetch, directory: async () => [{ formCode: "I-485J", pdfUrl: PDF("i-485supj-old-name") }] } });
  assert.deepEqual([found.ok, found.via], [true, "directory"]);
});

test("steps can be limited to one (the catalog runs them one at a time)", async () => {
  const site = realSite();
  const onlyStable = await resolveSource({ formCode: "I-485J", steps: ["stable_pdf"], deps: { fetch: site.fetch } });
  assert.equal(onlyStable.via, "stable_pdf");
  assert.ok(site.requests.every((request) => request.url.includes("/forms/")));
});

test("alias data: supplement spellings all reach the same entry, and unknown codes get the generic derivation", () => {
  for (const code of ["I-485J", "i-485j", "I-485 Supplement J", "I-485SUPJ"]) assert.equal(aliasFor(code)?.key, "I-485J", code);
  assert.equal(aliasFor("I-918 SUPPLEMENT A")?.key, "I-918SUPA");
  assert.equal(pageUrlFor("I-485J"), `${BASE}/i-485supj`);
  assert.equal(pageUrlFor("I-539A"), null);
  const info = describeForm("I-765");
  assert.deepEqual(info.pageSlugs, ["i-765", "i765"]);
  assert.equal(describeForm("I-539A").parentCode, "I-539");
  assert.equal(describeForm("I-765").parentCode, null);
});

test("the 25 stored 404 messages for I-485J / I-539A are all recoverable (replay)", async () => {
  const site = realSite();
  const history = [
    ...Array.from({ length: 13 }, () => ({ formCode: "I-485J", message: "USCIS page fetch failed: 404" })),
    ...Array.from({ length: 12 }, () => ({ formCode: "I-539A", message: "USCIS page fetch failed: 404" })),
  ];
  assert.equal(history.length, 25);
  for (const item of history) {
    const found = await resolveSource({ formCode: item.formCode, deps: { fetch: site.fetch, directory: async () => [] } });
    assert.equal(found.ok, true, `${item.formCode} must resolve`);
  }
});

test("write-back: saved once with the learned addresses, only when the autonomy switch is on", async () => {
  const site = realSite();
  const resolved = await resolveSource({ formCode: "I-485J", deps: { fetch: site.fetch } });
  const saved = [];
  const deps = { saveSource: async (template, fields) => saved.push({ id: template._id, fields }) };
  assert.equal(await rememberSource({ template: { _id: "t1" }, resolved, deps, env: { FORM_PIPELINE_AUTONOMY: "off" } }), false);
  assert.equal(await rememberSource({ template: { _id: "t1" }, resolved, deps, env: { FORM_PIPELINE_AUTONOMY: "shadow" } }), false);
  assert.equal(saved.length, 0);
  assert.equal(await rememberSource({ template: { _id: "t1" }, resolved, deps, env: { FORM_PIPELINE_AUTONOMY: "on" } }), true);
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].fields, { officialPdfUrl: PDF("i-485supj"), "lifecycle.sourcePdfUrl": PDF("i-485supj"), "lifecycle.sourcePageUrl": `${BASE}/i-485supj` });
  assert.equal(await rememberSource({ template: null, resolved, deps, env: { FORM_PIPELINE_AUTONOMY: "on" } }), false);
  assert.equal(await rememberSource({ template: { _id: "t1" }, resolved: { ok: false }, deps, env: { FORM_PIPELINE_AUTONOMY: "on" } }), false);
  assert.equal(await rememberSource({ template: { _id: "t1" }, resolved, deps: { saveSource: async () => { throw new Error("db"); } }, env: { FORM_PIPELINE_AUTONOMY: "on" } }), false, "a failing write never throws");
});

test("the import path leaves every failure that is not an address problem alone (no lookup, no network)", async () => {
  const { recoverFormSource } = require("../services/OnDemandFormAcquisitionService");
  for (const failure of ["USCIS page fetch failed: 503", "qpdf normalization failed", "no response within 15000 ms", "", undefined]) {
    assert.equal(await recoverFormSource({ formCode: "I-485J", existing: { _id: "t" }, failure, pageUrl: `${BASE}/i-485j` }), null, String(failure));
  }
});

test("the import path: guessedFormPageUrl uses the alias page, other forms keep the code-derived address", () => {
  const { guessedFormPageUrl } = require("../services/OnDemandFormAcquisitionService");
  assert.equal(guessedFormPageUrl("I-485J"), `${BASE}/i-485supj`);
  assert.equal(guessedFormPageUrl("I-129"), `${BASE}/i-129`);
  assert.equal(guessedFormPageUrl("I-539A"), `${BASE}/i-539a`);
  assert.equal(guessedFormPageUrl("I-129 O/P Classification Supplement"), null);
});

// ---- a supplement with no page of its own is found on its PARENT's page (I-539A on the I-539 page) ----
test("I-539A: no page of its own, found on the I-539 page that links both forms; the trail says where it looked", async () => {
  const { resolveSource } = require("../services/SourceResolver");
  const html = '<a href="/sites/default/files/document/forms/i-539.pdf">Form I-539</a> <a href="/sites/default/files/document/forms/i-539a.pdf">Form I-539A, Supplemental Information for Application to Extend/Change Nonimmigrant Status</a>';
  const fetch = async (url, { accept }) => {
    if (accept === "pdf") return url.endsWith("/i-539a.pdf") ? { ok: true, status: 200, bytes: Buffer.from("%PDF-1.7 fake"), finalUrl: url } : { ok: false, status: 404 };
    if (url === "https://www.uscis.gov/i-539") return { ok: true, status: 200, bytes: Buffer.from(html), finalUrl: url };
    return { ok: false, status: 404 }; // the form's own page does not exist
  };
  const found = await resolveSource({ formCode: "I-539A", deps: { fetch }, steps: ["alias", "parent_page", "stable_pdf"] });
  assert.equal(found.ok, true);
  assert.equal(found.via, "parent_page");
  assert.equal(found.pageUrl, "https://www.uscis.gov/i-539");
  assert.match(found.pdfUrl, /i-539a\.pdf$/);
  assert.ok(found.tried.some((step) => step.status === 404), "the failed addresses are in the trail");
  // nothing anywhere: not ok, with the whole trail (the error mechanism)
  const nothing = await resolveSource({ formCode: "I-539A", deps: { fetch: async () => ({ ok: false, status: 404 }) }, steps: ["alias", "parent_page", "stable_pdf"] });
  assert.equal(nothing.ok, false);
  assert.ok(nothing.tried.length >= 3);
});
