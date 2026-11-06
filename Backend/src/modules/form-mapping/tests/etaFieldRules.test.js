const assert = require("node:assert/strict");
const test = require("node:test");
const PartyFieldMappingService = require("../services/PartyFieldMappingService");

// DB-free: an authored rule of a DOL ETA-9089 form promotes a box whose low-confidence importer guess ALREADY pointed at the same canonical path (it used to stay "needs_review", and one such
// edge kept the whole mapping from activating). Every other form keeps the old behavior exactly.
const field = (name, page, type = "text") => ({ fieldId: `p${page}.${name.replace(/\W+/g, "")}`, fieldName: name, label: name, type, pageNumber: page, section: `Page ${page}` });
const edge = (target, sourcePath, status, confidence) => ({ mappingId: `m-${target.fieldId}`, formCode: "X", sourcePath, sourceType: "canonical", targetFieldId: target.fieldId, targetPdfField: target.fieldName, targetLabel: target.label, targetType: target.type, pageNumber: target.pageNumber, mappingType: "direct", confidence, status, transform: { type: "direct" } });

test("DOL form: a rule-agreeing review edge is promoted to active, so the mapping can activate", () => {
  const apartment = field("5  Address 2 apartmentsuitefloor and number", 1);
  const city = field("6  City", 1);
  const template = { _id: "t", formCode: "ETA-9089A", version: "v1", editionDate: new Date("2026-11-06"), formFields: [apartment, city] };
  const graph = { nodes: {}, edges: [edge(apartment, "beneficiary.apartment", "needs_review", 59), edge(city, "beneficiary.city", "needs_review", 80)], summary: {} };
  const { graph: next, report } = PartyFieldMappingService.plan(template, graph, { allowInference: false });
  assert.deepEqual(next.edges.map((e) => e.status), ["active", "active"]);
  assert.equal(next.edges[0].confidence, 90);
  assert.equal(next.edges[0].origin, "authored");
  assert.equal(next.edges[0].partyRule, "beneficiary.apartment");
  assert.equal(next.summary.reviewRequired, 0);
  assert.equal(report.unchanged, 0);
  assert.equal(next.validation.summary.reviewRequired, 0);
});

test("any EXCLUSIVE form (the I-9) gets the same promotion: a verified rule IS the verification", () => {
  const apartment = field("Apt Number (if any)", 1);
  const template = { _id: "t2", formCode: "I-9", version: "2026-01-01", editionDate: new Date("2026-01-01"), formFields: [apartment] };
  const graph = { nodes: {}, edges: [edge(apartment, "beneficiary.apartment", "needs_review", 59)], summary: {} };
  const { graph: next, report } = PartyFieldMappingService.plan(template, graph, { allowInference: false });
  assert.equal(next.edges[0].status, "active");
  assert.equal(report.promoted, 1);
  assert.equal(report.unchanged, 0);
});

test("a non-exclusive form with plain authored rules (the I-129) keeps the old behavior: an identical review edge stays as it is and is counted unchanged", () => {
  const company = field("Line3_CompanyorOrgName", 1);
  const template = { _id: "t4", formCode: "I-129", version: "2026-09-09", editionDate: new Date("2026-09-09"), formFields: [company] };
  const graph = { nodes: {}, edges: [edge(company, "petitioner.name", "needs_review", 59)], summary: {} };
  const { graph: next, report } = PartyFieldMappingService.plan(template, graph, { allowInference: false });
  assert.equal(report.unchanged, 1);
  assert.equal(report.promoted, undefined);
  assert.equal(next.edges[0].status, "needs_review");
  assert.equal(next.edges[0].confidence, 59);
});

test("DOL form: an edge that is already active is untouched and a box with no rule is removed (exclusive form)", () => {
  const last = field("1  Foreign Workers Last family Name", 1);
  const stray = field("10  Province", 1);
  const template = { _id: "t3", formCode: "ETA-9089A", version: "v1", editionDate: new Date("2026-11-06"), formFields: [last, stray] };
  const graph = { nodes: {}, edges: [edge(last, "beneficiary.lastName", "active", 95), edge(stray, "company.name", "needs_review", 40)], summary: {} };
  const { graph: next, report } = PartyFieldMappingService.plan(template, graph, { allowInference: false });
  assert.equal(next.edges.length, 1);
  assert.equal(next.edges[0].targetPdfField, last.fieldName);
  assert.equal(next.edges[0].confidence, 95, "an already-active edge keeps its own confidence");
  assert.equal(report.removed, 1, "the wrong auto-guess on a box no rule covers is removed");
});
