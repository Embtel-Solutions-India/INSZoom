const assert = require("node:assert/strict");
const test = require("node:test");

// USCIS Form Registry / S3 integration regression tests.
//
// DB-free by design, following this repo's convention (see
// questionnaires/tests/employmentChecklists.test.js): everything asserted
// here is a pure function of injected inputs. The DB- and S3-backed behavior
// (real registry sweep against the live bucket, signed-URL redemption over
// HTTP, case provisioning) was verified live against the running backend and
// is recorded in docs/USCIS_FORM_REGISTRY_S3_IMPLEMENTATION_REPORT.md.

const accessService = require("../uscis-form-access.service");

/* ── Signed form access grants (§16/§22/§40) ─────────────────────────────── */

test("a form access grant round-trips for the template it was minted for", () => {
  const { token, expiresInSeconds } = accessService.createFormAccessToken({
    templateId: "6aa32e7d20dd0a1d6b91eaf7",
    user: { _id: "user-1" },
  });
  const payload = accessService.verifyFormAccessToken(token, "6aa32e7d20dd0a1d6b91eaf7");
  assert.equal(payload.templateId, "6aa32e7d20dd0a1d6b91eaf7");
  assert.equal(payload.userId, "user-1");
  assert.equal(expiresInSeconds, accessService.DEFAULT_TTL_SECONDS);
});

test("a grant minted for one template is rejected against another (no cross-template replay)", () => {
  const { token } = accessService.createFormAccessToken({
    templateId: "template-a",
    user: { _id: "user-1" },
  });
  assert.throws(
    () => accessService.verifyFormAccessToken(token, "template-b"),
    (error) => error.status === 403
  );
});

test("a malformed or unsigned token is rejected", () => {
  assert.throws(
    () => accessService.verifyFormAccessToken("not-a-real-token", "template-a"),
    (error) => error.status === 401
  );
});

test("grant TTL is clamped so a caller cannot mint a long-lived link", () => {
  const huge = accessService.createFormAccessToken({ templateId: "t", user: {}, ttlSeconds: 86400 });
  assert.equal(huge.expiresInSeconds, accessService.MAX_TTL_SECONDS);
  const tiny = accessService.createFormAccessToken({ templateId: "t", user: {}, ttlSeconds: 1 });
  assert.equal(tiny.expiresInSeconds, 30);
});

test("minting a grant without a template id is refused", () => {
  assert.throws(() => accessService.createFormAccessToken({ user: {} }), /templateId is required/);
});

/* ── Registry health evaluation (§30) ────────────────────────────────────── */
//
// checkTemplate() talks to storage and Mongo, so these tests exercise the
// pure rollup/severity logic it composes from, which is where the
// "is this form usable" decision actually lives.

const health = require("../uscis-form-health.service");

test("health status vocabulary is the three documented states", () => {
  assert.deepEqual(
    Object.values(health.STATUS).sort(),
    ["error", "ok", "warning"]
  );
});

test("a template with no storage key is an ERROR, not a warning", async () => {
  const result = await health.checkTemplate({ formCode: "I-000", version: "1", status: "active" });
  assert.equal(result.status, health.STATUS.ERROR);
  const storageCheck = result.checks.find((item) => item.id === "storage_key");
  assert.equal(storageCheck.status, health.STATUS.ERROR);
});

test("a template with no active visa mapping degrades to WARNING (assignable gap, still filable)", async () => {
  // No storage key would mask this as ERROR, so this asserts the mapping
  // check itself rather than the rollup.
  const result = await health.checkTemplate({ formCode: "I-000-UNMAPPED", version: "1", status: "active" });
  const mappingCheck = result.checks.find((item) => item.id === "mappings");
  assert.equal(mappingCheck.status, health.STATUS.WARNING);
  assert.match(mappingCheck.detail, /never be auto-assigned/);
});

test("a non-fillable template is flagged (cannot be auto-filled)", async () => {
  const result = await health.checkTemplate({ formCode: "I-000", version: "1", formFields: [] });
  const fillable = result.checks.find((item) => item.id === "fillable");
  assert.equal(fillable.status, health.STATUS.WARNING);
});

test("a template whose two storage keys disagree is surfaced rather than silently preferred", async () => {
  const result = await health.checkTemplate({
    formCode: "I-000",
    version: "1",
    pdfStorageKey: "a/one.pdf",
    artifacts: { form: { storageKey: "b/two.pdf" } },
  });
  const consistency = result.checks.find((item) => item.id === "storage_key_consistency");
  assert.ok(consistency, "expected a storage_key_consistency check");
  assert.equal(consistency.status, health.STATUS.WARNING);
});

/* ── Version identity (§13) ──────────────────────────────────────────────── */

const USCISFormTemplate = require("../../../models/USCISFormTemplate");

test("form identity is formCode + version, enforced by a unique index", () => {
  const indexes = USCISFormTemplate.schema.indexes();
  const identityIndex = indexes.find(([fields]) => fields.formCode === 1 && fields.version === 1);
  assert.ok(identityIndex, "expected a compound {formCode, version} index");
  assert.equal(identityIndex[1].unique, true, "form identity index must be unique");
});

/* ── Registry / mapping separation (§18) ─────────────────────────────────── */

const VisaFormMapping = require("../../../models/VisaFormMapping");

test("the form registry and the visa mapping stay separate models", () => {
  assert.notEqual(USCISFormTemplate.modelName, VisaFormMapping.modelName);
  // The registry must not carry per-visa assignment semantics — that is the
  // mapping's job (§18/§19).
  assert.equal(USCISFormTemplate.schema.path("provisioningType"), undefined);
  assert.ok(VisaFormMapping.schema.path("provisioningType"), "mapping owns provisioningType");
});

test("assignment types cover required / conditional / optional semantics", () => {
  for (const expected of ["AUTO_CREATE", "CONDITIONAL", "LATER_STAGE", "REFERENCE", "NOT_APPLICABLE"]) {
    assert.ok(
      VisaFormMapping.PROVISIONING_TYPES.includes(expected),
      `missing provisioning type ${expected}`
    );
  }
});

test("mapping conditions are evaluated server-side against a whitelisted field set", () => {
  assert.ok(Array.isArray(VisaFormMapping.TRIGGER_FIELD_WHITELIST));
  assert.ok(VisaFormMapping.TRIGGER_FIELD_WHITELIST.length > 0);
  // validateTriggerNode RETURNS an error string (null when valid) rather than
  // throwing — it's wired in as the schema validator for triggerCondition.
  // A condition referencing an arbitrary field must be rejected; this is what
  // stops conditions from being invented client-side (§19).
  const rejected = VisaFormMapping.validateTriggerNode(
    { field: "totallyMadeUpField", operator: "equals", value: "x" },
    "triggerCondition"
  );
  assert.match(String(rejected), /not in the approved trigger field whitelist/);
  // A whitelisted field with a supported operator passes.
  assert.equal(
    VisaFormMapping.validateTriggerNode({ field: "premiumProcessing", operator: "equals", value: true }),
    null
  );
  // An unsupported operator is rejected even on a whitelisted field.
  assert.match(
    String(VisaFormMapping.validateTriggerNode({ field: "premiumProcessing", operator: "regex", value: ".*" })),
    /must be one of/
  );
});

/* ── Case version locking (§14) ──────────────────────────────────────────── */

const CaseForm = require("../../../models/CaseForm");

test("a CaseForm records the exact registry version it was provisioned from", () => {
  // formVersionLock is declared as a nested object, so its members appear as
  // flattened "formVersionLock.x" schema paths rather than a subdocument.
  for (const field of ["formTemplateId", "editionDate", "version", "lockedAt"]) {
    assert.ok(
      CaseForm.schema.path(`formVersionLock.${field}`),
      `formVersionLock is missing ${field}`
    );
  }
});

test("a CaseForm keeps its own field values separate from the global template", () => {
  // §24: editing a case must never mutate the registry template.
  assert.ok(CaseForm.schema.path("fieldValues"), "CaseForm owns fieldValues");
  assert.ok(CaseForm.schema.path("fieldValueProvenance"), "CaseForm owns per-field provenance");
  assert.equal(USCISFormTemplate.schema.path("fieldValues"), undefined,
    "the global template must not carry case field values");
});

/* ── Canonical visa registry (§32/§33) ───────────────────────────────────── */

const { VISA_CATEGORIES } = require("../../../config/visaCategories");

test("the visa vocabulary used for mappings is the canonical registry", () => {
  assert.ok(Object.keys(VISA_CATEGORIES).length > 50, "expected the full canonical visa list");
  // Spot-check the visa types the spec calls out explicitly (§37/§38).
  for (const visa of ["H-1B", "L-1A", "EB-1B", "EB-2 NIW"]) {
    assert.ok(VISA_CATEGORIES[visa], `canonical registry is missing ${visa}`);
  }
});
