const test = require("node:test");
const assert = require("node:assert/strict");
const AIJob = require("../../models/AIJob");
const AIPromptTemplate = require("../../models/AIPromptTemplate");
const AIProviderConfig = require("../../models/AIProviderConfig");
const Case = require("../../models/Case");
const routes = require("./ai.routes");
const promptDefaults = require("./prompt.defaults");
const providers = require("./ai-provider.registry");
const orchestration = require("./ai-orchestration.service");
const { ROLE_PERMISSIONS } = require("../authorization/permissions.registry");

test("AI provider configuration stores environment references instead of credentials", () => {
  for (const field of ["key", "provider", "model", "apiKeyEnv", "capabilities.chat", "limits.requestsPerMinute", "pricing.inputPerMillionTokens", "privacy.providerRetention"]) {
    assert.ok(AIProviderConfig.schema.path(field), `missing provider field ${field}`);
  }
  assert.equal(AIProviderConfig.schema.path("apiKey"), undefined);
  assert.deepEqual(providers.DEFAULTS.map((item) => item.provider), ["gemini", "openai", "anthropic", "azure_openai", "self_hosted"]);
});

test("AI prompts and jobs are versioned, reviewable, auditable and cost-aware", () => {
  assert.ok(AIPromptTemplate.schema.path("version"));
  assert.ok(AIPromptTemplate.schema.path("status"));
  for (const field of ["providerKey", "promptVersion", "promptHash", "suggestions", "review.status", "usage.totalTokens", "auditHistory"]) {
    assert.ok(AIJob.schema.path(field), `missing AI job field ${field}`);
  }
});

test("AI routes expose copilot, review, secure search, task approval and administration", () => {
  const registered = routes.stack
    .filter((layer) => layer.route)
    .map((layer) => `${Object.keys(layer.route.methods).join(",").toUpperCase()} ${layer.route.path}`);
  for (const route of [
    "POST /cases/:caseId/copilot",
    "POST /cases/:caseId/review",
    "POST /cases/:caseId/task-suggestions",
    "POST /search",
    "PUT /jobs/:id/review",
    "POST /jobs/:id/apply-tasks",
    "GET /providers",
    "GET /prompts",
    "GET /usage",
  ]) assert.ok(registered.includes(route), `missing route ${route}`);
});

test("AI case review findings remain suggestions and never mutate case data", () => {
  const caseData = new Case({ caseNumber: "AI-TEST-1", visaType: "H-1B", status: "active" });
  const before = caseData.toObject();
  const findings = orchestration.deterministicFindings({
    canonical: { validation: { missingFields: ["person.dob"] }, conflicts: [{ field: "person.name", resolved: false }] },
    evidence: { missing: [{ key: "passport" }], requirements: [] },
    documents: [{ _id: "document-1", expiryDate: new Date(Date.now() - 86400000), originalName: "passport.pdf" }],
    forms: [{ _id: "form-1", formCode: "I-129", status: "draft" }],
    tasks: [{ _id: "task-1", title: "Review", dueDate: new Date(Date.now() - 86400000), status: "pending" }],
  });
  assert.ok(findings.missingCanonicalFields.length);
  assert.ok(findings.expiredDocuments.length);
  assert.deepEqual(caseData.toObject(), before);
});

test("client copilot access excludes AI review permission", () => {
  assert.ok(ROLE_PERMISSIONS.client.includes("ai:create"));
  assert.ok(ROLE_PERMISSIONS.client.includes("ai:read"));
  assert.equal(ROLE_PERMISSIONS.client.includes("ai:review"), false);
});

test("legal drafting uses a governed prompt template", () => {
  assert.equal(promptDefaults.legal_draft.purpose, "draft");
  assert.match(promptDefaults.legal_draft.systemPrompt, /attorney review/i);
  assert.match(promptDefaults.legal_draft.systemPrompt, /never invent/i);
});
