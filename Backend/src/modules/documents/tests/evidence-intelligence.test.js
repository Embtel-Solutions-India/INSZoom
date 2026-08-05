const test = require("node:test");
const assert = require("node:assert/strict");
const Document = require("../../../models/Document");
const documentRoutes = require("../document.routes");
const evidenceService = require("../evidence.service");

test("document evidence associations retain enterprise intelligence metadata", () => {
  const association = Document.schema.path("evidenceAssociations").schema;
  for (const field of ["criterion", "category", "confidence", "strengthScore", "strengthLevel", "supportingForms", "petitionParagraphKeys", "rationale", "source"]) {
    assert.ok(association.path(field), `missing evidence field ${field}`);
  }
});

test("evidence summary and classification APIs are registered", () => {
  const routes = documentRoutes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(",").toUpperCase()} ${layer.route.path}`);
  assert.ok(routes.includes("GET /evidence/cases/:caseId"));
  assert.ok(routes.includes("POST /:id/evidence/classify"));
});

test("evidence service exposes case summary and document classification", () => {
  assert.equal(typeof evidenceService.caseEvidenceSummary, "function");
  assert.equal(typeof evidenceService.classifyDocument, "function");
});
