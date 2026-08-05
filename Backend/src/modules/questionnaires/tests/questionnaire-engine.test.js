const assert = require("node:assert/strict");
const test = require("node:test");
const Answer = require("../../../models/Answer");
const Case = require("../../../models/Case");
const Question = require("../../../models/Question");
const router = require("../questionnaire.routes");

function routes() {
  return router.stack
    .filter((layer) => layer.route)
    .flatMap((layer) => Object.keys(layer.route.methods).map((method) => `${method.toUpperCase()} ${layer.route.path}`));
}

test("questionnaire schemas support master case data synchronization", () => {
  assert.ok(Question.schema.path("mapping.masterDataPath"));
  assert.ok(Question.schema.path("mapping.canonicalPath"));
  assert.ok(Answer.schema.path("masterDataPath"));
  assert.ok(Answer.schema.path("masterDataSnapshot"));
  assert.ok(Answer.schema.path("validation.errors"));
  assert.ok(Case.schema.path("questionnaireData.masterData"));
  assert.ok(Case.schema.path("questionnaireData.questionnaireVersion"));
  assert.ok(Case.schema.path("questionnaireData.progress"));
});

test("questionnaire engine validation endpoints are registered", () => {
  const registered = routes();
  assert.ok(registered.includes("GET /:id/validation"));
  assert.ok(registered.includes("POST /:id/validate"));
});
