const test = require("node:test");
const assert = require("node:assert/strict");
const routes = require("./petition-intelligence.routes");
const service = require("./petition-intelligence.service");
const fs = require("node:fs");
const path = require("node:path");

test("petition intelligence supports every professional draft artifact", () => {
  for (const type of ["petition_draft", "cover_letter", "support_letter", "attorney_summary", "case_summary", "rfe_draft", "evidence_summary"]) {
    assert.ok(service.ARTIFACT_TYPES[type], `missing artifact type ${type}`);
  }
});

test("petition intelligence APIs are protected and registered", () => {
  const registered = routes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(",").toUpperCase()} ${layer.route.path}`);
  assert.ok(registered.includes("GET /cases/:caseId"));
  assert.ok(registered.includes("POST /cases/:caseId/generate"));
});

test("petition drafting uses provider-neutral AI orchestration", () => {
  const source = fs.readFileSync(path.join(__dirname, "petition-intelligence.service.js"), "utf8");
  assert.match(source, /aiOrchestration\.run\("draft"/);
  assert.doesNotMatch(source, /geminiService/);
});
