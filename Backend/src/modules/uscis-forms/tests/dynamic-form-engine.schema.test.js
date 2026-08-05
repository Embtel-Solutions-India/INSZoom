const assert = require("node:assert/strict");
const test = require("node:test");
const Case = require("../../../models/Case");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");

test("USCIS form registry stores enterprise version metadata", () => {
  assert.ok(USCISFormTemplate.schema.path("registryId"));
  assert.ok(USCISFormTemplate.schema.path("supportedVisaCategories"));
  assert.ok(USCISFormTemplate.schema.path("retirementDate"));
  assert.ok(USCISFormTemplate.schema.path("mappingConfiguration"));
  assert.ok(USCISFormTemplate.schema.path("renderingConfiguration"));
  assert.ok(USCISFormTemplate.schema.path("validationConfiguration"));
  assert.ok(USCISFormTemplate.schema.path("mappingVersion"));
  assert.ok(USCISFormTemplate.schema.path("validationVersion"));
  assert.ok(USCISFormTemplate.schema.path("renderingVersion"));
  assert.ok(USCISFormTemplate.schema.path("activeFlag"));
  assert.ok(USCISFormTemplate.schema.path("officialStatus"));
  assert.ok(USCISFormTemplate.schema.path("revisionDate"));
  assert.ok(USCISFormTemplate.schema.path("instructionsPdfUrl"));
  assert.ok(USCISFormTemplate.schema.path("relatedForms"));
  assert.ok(USCISFormTemplate.schema.path("activeMappingVersion"));
  assert.ok(USCISFormTemplate.schema.path("activeMappingVersionId"));
  assert.ok(USCISFormTemplate.schema.path("immutableVersionId"));
  assert.ok(USCISFormTemplate.schema.path("instructionsStorageKey"));
  assert.ok(USCISFormTemplate.schema.path("artifacts.form.checksum"));
  assert.ok(USCISFormTemplate.schema.path("artifacts.instructions.checksum"));
  assert.ok(USCISFormTemplate.schema.path("parserMetadata.status"));
  assert.ok(USCISFormTemplate.schema.path("parserMetadata.reviewItems"));
});

test("USCIS mapping versions preserve immutable edition-specific graphs", () => {
  assert.ok(USCISMappingVersion.schema.path("template"));
  assert.ok(USCISMappingVersion.schema.path("formVersion"));
  assert.ok(USCISMappingVersion.schema.path("mappingVersion"));
  assert.ok(USCISMappingVersion.schema.path("checksum"));
  assert.ok(USCISMappingVersion.schema.path("graph"));
  assert.ok(CaseForm.schema.path("formVersionLock.mappingVersionId"));
});

test("CaseForm locks assigned USCIS edition and mapping versions", () => {
  assert.ok(CaseForm.schema.path("formVersionLock.mappingVersion"));
  assert.ok(CaseForm.schema.path("formVersionLock.validationVersion"));
  assert.ok(CaseForm.schema.path("formVersionLock.renderingVersion"));
  assert.ok(CaseForm.schema.path("syncState.requiresRegeneration"));
  assert.ok(CaseForm.schema.path("comparisonBaseline.fieldValues"));
});

test("Case stores assigned form version metadata", () => {
  assert.ok(Case.schema.path("uscisFormReferences.version"));
  assert.ok(Case.schema.path("uscisFormReferences.editionDate"));
  assert.ok(Case.schema.path("uscisFormReferences.mappingVersion"));
});
