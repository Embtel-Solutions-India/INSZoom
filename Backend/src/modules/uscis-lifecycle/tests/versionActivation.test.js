// Phase 0: only a certified edition goes live; a non-critical certification failure needs a written, audited reason. DB-free (pure decision + model stubs).
const test = require("node:test");
const assert = require("node:assert/strict");
const VersionManagementService = require("../services/VersionManagementService");

const { certificationDecision, CRITICAL_CERTIFICATION_CHECKS } = VersionManagementService;
const cert = (checks, passed) => ({ importMetadata: { validationSummary: { certification: { passed, checks } } } });
const check = (name, passed = true) => ({ name, passed, detail: "x" });

test("the critical checks are exactly the five that decide whether a form can be filled correctly (Phase 3 added party_markers and widget_inputs)", () => {
  assert.deepEqual([...CRITICAL_CERTIFICATION_CHECKS], ["pdf_fillable", "mapping_valid", "fill_roundtrip", "party_markers", "widget_inputs"]);
});

test("a check the policy does not know is critical (a crashed certification can never be waved through)", () => {
  const result = certificationDecision(cert([check("certification", false)], false), { body: { overrideReason: "the business needs this form now" } });
  assert.equal(result.ok, false);
  assert.match(result.error, /certification/);
});

test("a passing certification activates; a missing one never does (certify first, not overridable)", () => {
  assert.deepEqual(certificationDecision(cert([check("pdf_fillable")], true), {}), { ok: true });
  const missing = certificationDecision({ importMetadata: {} }, { body: { overrideReason: "a perfectly long reason here" } });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not been certified/);
  assert.equal(certificationDecision({}, {}).ok, false);
});

test("a failed CRITICAL check can never be overridden", () => {
  for (const name of CRITICAL_CERTIFICATION_CHECKS) {
    const result = certificationDecision(cert([check(name, false), check("viewer_download")], false), { body: { overrideReason: "the business needs this form now" } });
    assert.equal(result.ok, false, name);
    assert.match(result.error, new RegExp(name));
  }
  assert.equal(certificationDecision(cert([], false), { body: { overrideReason: "the business needs this form now" } }).ok, false, "failed with no recorded check is treated as critical");
});

test("a failed NON-critical check needs a written reason (10+ characters), which is returned for the audit trail", () => {
  const template = cert([check("pdf_fillable"), check("viewer_download", false), check("components_slice", false)], false);
  const refused = certificationDecision(template, { body: { overrideReason: "too short" } });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /viewer_download, components_slice/);
  assert.equal(certificationDecision(template, {}).ok, false);
  const allowed = certificationDecision(template, { body: { overrideReason: "  Components verified by hand on 2026-10-16  " } });
  assert.deepEqual(allowed, { ok: true, override: { reason: "Components verified by hand on 2026-10-16", failed: ["viewer_download", "components_slice"] } });
});
