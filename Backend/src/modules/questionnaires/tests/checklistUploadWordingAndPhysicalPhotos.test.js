// Every checklist: (1) nothing is delivered by e-mail - the wording says to upload here; (2) the "Physical Photographs" item is a REQUIRED choice whose single option is the
// instruction itself (bring them to the office), and the stored value is that same sentence, because the Admin portal shows the stored value as written.
const test = require("node:test");
const assert = require("node:assert/strict");
const { PHYSICAL_PHOTOS_LINE, PHYSICAL_PHOTOS_OPTIONS } = require("../definitionHelpers");
const service = require("../questionnaire.service");
const { isQuestionVisible, isQuestionRequired, validateQuestionValue, VISA_TEMPLATE_DEFINITIONS } = service;

const EMAIL_DELIVERY = /via e-?mail|by e-?mail|e-?mail attachment|e-?mail it|send (it |a clear photo of it )?to us|send us|send it by/i;
const textsOf = (definition) => [definition.title, definition.description, ...definition.sections, ...definition.questions.flatMap((question) => [question.label, question.description, ...(question.options || []).flatMap((o) => [o.label, o.value])])]
  .filter((value) => typeof value === "string");
const physical = (definition) => definition.questions.filter((question) => /physical_photos/.test(question.key));

test("no checklist asks for anything to be sent by e-mail (every built-in checklist is scanned)", () => {
  assert.ok(VISA_TEMPLATE_DEFINITIONS.length > 40, "the built-in checklists are registered");
  for (const definition of VISA_TEMPLATE_DEFINITIONS) {
    for (const text of textsOf(definition)) assert.ok(!EMAIL_DELIVERY.test(text), definition.key + ": " + text.slice(0, 90));
  }
});

test("Physical Photographs: required, one option that is the instruction itself, stored value = that sentence", () => {
  assert.match(PHYSICAL_PHOTOS_LINE, /Bring three identical physical passport-sized photographs with you when you come to the office\./);
  assert.deepEqual(PHYSICAL_PHOTOS_OPTIONS, [{ label: PHYSICAL_PHOTOS_LINE, value: PHYSICAL_PHOTOS_LINE }]);
  const withPhysical = VISA_TEMPLATE_DEFINITIONS.filter((definition) => physical(definition).length);
  assert.ok(withPhysical.length >= 13, "all the OCI, Renunciation, Indian Passport Renewal and E-Tourist Business checklists carry it (" + withPhysical.length + ")");
  for (const definition of withPhysical) {
    const [question] = physical(definition);
    assert.equal(physical(definition).length, 1, definition.key + " has exactly one physical-photographs item");
    assert.equal(question.type, "radio", definition.key);
    assert.equal(question.required, true, definition.key + " physical photographs are required");
    assert.deepEqual(question.options, PHYSICAL_PHOTOS_OPTIONS, definition.key + " uses the shared option");
    assert.equal(isQuestionVisible(question, {}, { role: "client" }), true, definition.key);
    assert.equal(isQuestionRequired(question, {}), true, definition.key);
    assert.ok(!/acknowledg|confirmed|I will provide/i.test(JSON.stringify(question.options)), definition.key + " is not worded as an acknowledgement");
    assert.equal(validateQuestionValue(question, PHYSICAL_PHOTOS_LINE).valid !== false, true, definition.key + " accepts the instruction as the answer");
  }
});
