// Phase 1 acceptance tests for the USCIS form-rendering pipeline. Like
// uscis-form-import/tests/h0-i129-seed.test.js, this is a deliberate,
// scoped exception to this repo's normally DB-free suite (see
// data-rights/tests/dataRights.service.test.js) - "the form is discoverable
// in the real DB and its PDF is actually fetchable over the real HTTP API"
// is inherently an integration claim that a mocked model/route can't prove.
// Requires a reachable MongoDB (env.mongoUri) with the USCIS form templates
// already seeded (server.js does this automatically on boot) and at least
// one active user per staff role tested below.
const assert = require("node:assert/strict");
const test = require("node:test");
const http = require("node:http");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const User = require("../../../models/User");
const storageService = require("../../uploads/storage.service");
const { generateAccessToken } = require("../../auth/token.service");
const app = require("../../../app");

let server;
let baseUrl;

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

async function authHeaderForRole(role) {
  const user = await User.findOne({ role, isActive: true }).select("_id role tokenVersion");
  assert.ok(user, `expected at least one active "${role}" user in the seeded DB to authenticate as`);
  const token = generateAccessToken(user);
  return `Bearer ${token}`;
}

test("USCIS form templates exist in the database with a resolvable, real PDF artifact", async () => {
  const templates = await USCISFormTemplate.find({ status: "active", activeFlag: true })
    .select("formCode version artifacts pdfStorageKey")
    .lean();

  assert.ok(templates.length > 0, "expected at least one active USCIS form template - none were found in the DB");

  for (const template of templates) {
    const key = template.artifacts?.form?.storageKey || template.pdfStorageKey;
    assert.ok(key, `${template.formCode} ${template.version} has no stored PDF artifact key`);

    const buffer = await storageService.readBuffer(key);
    assert.ok(buffer?.length > 0, `${template.formCode} ${template.version}'s stored artifact (${key}) is empty or unreadable`);
    assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-", `${template.formCode} ${template.version}'s stored artifact is not a valid PDF`);

    // Real USCIS PDFs are commonly Adobe LiveCycle "hybrid" forms: a real,
    // fillable /AcroForm alongside a legacy /XFA packet array kept only for
    // Acrobat round-tripping (confirmed on I-129: /Fields [21 0 R] /XFA [...]).
    // That's fine - browsers/pdf.js/react-pdf and this pipeline's own
    // pdf-lib usage all key off /AcroForm and simply ignore /XFA. What
    // actually breaks AcroForm-based rendering is /NeedsRendering true,
    // which marks a form as Adobe-only *dynamic* XFA with no reliable
    // AcroForm fallback - that's the real "can't render outside Adobe" case
    // this pipeline (and requirement #4 - don't rely on pdf-lib for XFA)
    // needs to catch.
    const text = buffer.toString("latin1");
    assert.ok(text.includes("/AcroForm"), `${template.formCode} ${template.version} has no /AcroForm dictionary`);
    assert.ok(!/\/NeedsRendering\s+true/.test(text), `${template.formCode} ${template.version} is marked /NeedsRendering true - this is an Adobe-only dynamic XFA form that AcroForm-based rendering (pdf-lib, pdf.js/react-pdf) cannot reliably fill or display`);
  }
});

test("GET /uscis-forms/registry returns 200 with valid form metadata for an authenticated case manager", async () => {
  const authorization = await authHeaderForRole("case_manager");

  const response = await fetch(`${baseUrl}/uscis-forms/registry`, { headers: { authorization } });
  const body = await response.json();

  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.success, true);
  const templates = body.data || body.templates || body.registry;
  assert.ok(Array.isArray(templates) && templates.length > 0, "registry response did not contain a non-empty list of templates");
  templates.forEach((template) => {
    assert.ok(template.formCode, "template metadata is missing formCode");
    assert.ok(template._id, "template metadata is missing _id");
  });
});

test("GET /uscis-forms/:id/pdf returns a real, browser-viewable PDF for every active template (no XFA errors, no 404, no localhost URL)", async () => {
  const authorization = await authHeaderForRole("case_manager");
  const templates = await USCISFormTemplate.find({ status: "active", activeFlag: true }).select("_id formCode version").lean();
  assert.ok(templates.length > 0, "no active templates to test against");

  for (const template of templates) {
    const response = await fetch(`${baseUrl}/uscis-forms/${template._id}/pdf`, { headers: { authorization } });
    assert.equal(response.status, 200, `${template.formCode} ${template.version}: expected 200, got ${response.status}`);
    assert.match(response.headers.get("content-type") || "", /application\/pdf/, `${template.formCode} ${template.version}: wrong content-type`);

    const buffer = Buffer.from(await response.arrayBuffer());
    assert.equal(buffer.subarray(0, 5).toString("latin1"), "%PDF-", `${template.formCode} ${template.version}: response body is not a valid PDF`);
  }
});

test("GET /uscis-forms/:id/pdf 404s cleanly (not a silent failure) for a template that doesn't exist", async () => {
  const authorization = await authHeaderForRole("case_manager");
  const missingId = new mongoose.Types.ObjectId();

  const response = await fetch(`${baseUrl}/uscis-forms/${missingId}/pdf`, { headers: { authorization } });
  const body = await response.json();

  assert.equal(response.status, 404);
  assert.equal(body.success, false);
  assert.ok(body.message, "404 response has no message - frontend would have nothing to show the user");
});

test("GET /uscis-forms/case (list all case forms) returns 200 instead of crashing on response size", async () => {
  // Phase 2 regression: found via the real browser E2E test's discovery
  // step. Unfiltered, this listed ~100 CaseForm rows each fully populating
  // formTemplateId (a template's entire formFields array - ~1000 entries
  // with coordinates/mapping/history for a form like I-129), then returned
  // that same bloated array three times over under forms/caseForms/data -
  // JSON.stringify threw "Invalid string length" and the request 500'd
  // (confirmed live before the fix trimmed the populate projection and the
  // response duplication).
  const authorization = await authHeaderForRole("case_manager");
  const response = await fetch(`${baseUrl}/uscis-forms/case`, { headers: { authorization } });
  const body = await response.json();

  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body).slice(0, 500)}`);
  assert.equal(body.success, true);
  assert.ok(Array.isArray(body.data) && body.data.length > 0, "expected a non-empty list of case forms");
  const withTemplate = body.data.find((f) => f.formTemplateId && f.formTemplateId.formCode);
  assert.ok(withTemplate, "expected at least one case form with a populated template");
  assert.ok(!withTemplate.formTemplateId.formFields, "template should be projected down to identifying fields only, not its full formFields array");
});
