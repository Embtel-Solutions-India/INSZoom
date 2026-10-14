// DB-free: which checklist questions are REQUIRED (to submit), and that nothing is ever required to SAVE.
const test = require("node:test");
const assert = require("node:assert/strict");
const service = require("../questionnaire.service");

const q = (over = {}) => ({ key: "q", label: "Question", type: "text", required: false, validationRules: [], metadata: {}, ...over });
const answers = (map = {}) => Object.fromEntries(Object.entries(map).map(([key, value]) => [key, { questionKey: key, value }]));

test("a question is required by its own flag, a required rule, or a requireWhen condition that is true", () => {
  assert.equal(service.isQuestionRequired(q({ required: true }), {}), true);
  assert.equal(service.isQuestionRequired(q(), {}), false, "no flag, no rule, no condition: not required");
  assert.equal(service.isQuestionRequired(q({ validationRules: [{ type: "required" }] }), {}), true);
  const whenYes = { metadata: { requireWhen: { rules: [{ questionKey: "hasX", operator: "equals", value: "Yes" }] } } };
  assert.equal(service.isQuestionRequired(q(whenYes), answers({ hasX: "Yes" })), true, "required once the condition holds");
  assert.equal(service.isQuestionRequired(q(whenYes), answers({ hasX: "No" })), false, "not required while it does not");
});

test("a question flagged metadata.optional is never required, even when its flag says so", () => {
  assert.equal(service.isQuestionRequired(q({ required: true, metadata: { optional: true } }), {}), false);
});

test("a malformed requireWhen never blocks and never throws", () => {
  assert.equal(service.isQuestionRequired(q({ metadata: { requireWhen: { rules: [null] } } }), {}), false);
});

test("nothing is required to SAVE: a blank answer to a required question is not a save error (only Submit is gated)", () => {
  const required = q({ required: true, validationRules: [{ type: "required" }] });
  assert.deepEqual(service.validateQuestionValue(required, "").errors, []);
  assert.deepEqual(service.validateQuestionValue(required, undefined).errors, []);
});

test("format rules still judge an answer that was given", () => {
  const withMin = q({ required: true, validationRules: [{ type: "minLength", value: 5 }] });
  assert.ok(service.validateQuestionValue(withMin, "abc").errors.length >= 1);
  assert.deepEqual(service.validateQuestionValue(withMin, "abcdef").errors, []);
});

test("the built-in checklist definitions carry required questions again (they are what the stored flags are restored from)", () => {
  const definitions = service.VISA_TEMPLATE_DEFINITIONS;
  const withRequired = definitions.filter((definition) => (definition.questions || []).some((question) => question.required === true));
  assert.ok(withRequired.length > 50, `many definitions mark questions required (found ${withRequired.length})`);
  // passport information is required wherever a definition asks for it
  const everyPassportRequired = definitions.every((definition) => (definition.questions || []).filter((question) => /passport/i.test(question.key || "") && /number/i.test(question.key || "")).every((question) => question.required === true || question.metadata?.optional));
  assert.equal(everyPassportRequired, true);
});
