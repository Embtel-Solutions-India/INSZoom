// Phase 2 (Registry-wide FORM_COMPONENT integration) §20 - iterates every
// ACTIVE USCISFormComponentDefinition currently in the live registry (not a
// hardcoded list) and verifies each is structurally sound enough to reach
// ComponentPageResolver safely. Fails loudly if a future component is added
// with broken metadata - this is the acceptance gate for that, not a
// snapshot of today's known-good components.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const { expandPageRanges } = require("../services/ComponentPageResolver");

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
});

test.after(async () => {
  await mongoose.disconnect();
});

test("Registry-wide audit: every ACTIVE USCISFormComponentDefinition is structurally valid", async () => {
  const activeDefs = await USCISFormComponentDefinition.find({ status: "ACTIVE" }).lean();
  assert.ok(activeDefs.length > 0, "expected at least one ACTIVE component definition to exist and be auditable");

  const templateCache = new Map();
  const seenComponentCodesPerParent = new Map(); // parentTemplateId -> Set(componentCode) - uniqueness check

  for (const def of activeDefs) {
    const label = `${def.parentFormCode}/${def.componentCode}`;

    // parentTemplateId + componentCode present
    assert.ok(def.parentTemplateId, `${label}: parentTemplateId must be set`);
    assert.ok(def.componentCode, `${label}: componentCode must be set`);
    assert.ok(def.parentFormCode, `${label}: parentFormCode must be set`);

    // Uniqueness: no two ACTIVE defs share {parentTemplateId, componentCode} -
    // the DB unique index already enforces this at write time, but this
    // independently re-verifies it holds for the current live data.
    const key = String(def.parentTemplateId);
    if (!seenComponentCodesPerParent.has(key)) seenComponentCodesPerParent.set(key, new Set());
    const seen = seenComponentCodesPerParent.get(key);
    assert.ok(!seen.has(def.componentCode), `${label}: duplicate ACTIVE componentCode for the same parentTemplateId`);
    seen.add(def.componentCode);

    // Parent template exists and is the currently-active edition.
    let template = templateCache.get(key);
    if (template === undefined) {
      template = await USCISFormTemplate.findById(def.parentTemplateId).select("_id formCode status activeFlag version pdfMetadata.pageCount").lean();
      templateCache.set(key, template);
    }
    assert.ok(template, `${label}: parentTemplateId does not resolve to any USCISFormTemplate`);
    assert.equal(template.status, "active", `${label}: parent template ${template?.formCode} is not status:"active"`);
    assert.equal(def.templateVersion, template.version, `${label}: templateVersion (${def.templateVersion}) does not match the current parent template's version (${template.version}) - stale definition from a superseded edition`);

    // pageRanges: present, valid, within the parent's real page count.
    const totalPages = template.pdfMetadata?.pageCount;
    assert.ok(totalPages > 0, `${label}: parent template has no pdfMetadata.pageCount to validate against`);
    const context = { parentFormCode: def.parentFormCode, componentCode: def.componentCode };
    let expandedPages;
    assert.doesNotThrow(() => {
      expandedPages = expandPageRanges(def.pageRanges, totalPages, context);
    }, `${label}: pageRanges failed validation against the real parent PDF (${totalPages} pages)`);
    assert.ok(expandedPages.length > 0, `${label}: resolved zero pages`);

    // fieldIds (where present) must each belong to a real template field
    // whose own pageNumber falls inside this component's resolved pages -
    // re-verifies the same invariant USCISFormComponentDiscoveryService
    // enforces at discovery time, as a live registry-wide sweep.
    if (def.fieldIds && def.fieldIds.length) {
      const fullTemplate = await USCISFormTemplate.findById(def.parentTemplateId).select("formFields").lean();
      const fieldsById = new Map((fullTemplate.formFields || []).map((f) => [f.fieldId || f.fieldName, f]));
      const pageSet = new Set(expandedPages);
      for (const fieldId of def.fieldIds) {
        const field = fieldsById.get(fieldId);
        assert.ok(field, `${label}: fieldIds references "${fieldId}", which does not exist in the parent template's formFields`);
        assert.ok(pageSet.has(field.pageNumber), `${label}: field "${fieldId}" has pageNumber ${field.pageNumber}, outside this component's own resolved pages`);
      }
    }
  }
});

test("Registry-wide audit: no two ACTIVE components under the same parent template have overlapping pages", async () => {
  const activeDefs = await USCISFormComponentDefinition.find({ status: "ACTIVE" }).lean();
  const byParent = new Map();
  for (const def of activeDefs) {
    const key = String(def.parentTemplateId);
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(def);
  }
  for (const [parentTemplateId, defs] of byParent) {
    const claimed = new Map(); // page -> componentCode
    for (const def of defs) {
      for (const range of def.pageRanges) {
        for (let p = range.startPage; p <= range.endPage; p += 1) {
          const priorOwner = claimed.get(p);
          assert.ok(!priorOwner, `parentTemplateId ${parentTemplateId}: page ${p} is claimed by both "${priorOwner}" and "${def.componentCode}" - overlapping active components`);
          claimed.set(p, def.componentCode);
        }
      }
    }
  }
});
