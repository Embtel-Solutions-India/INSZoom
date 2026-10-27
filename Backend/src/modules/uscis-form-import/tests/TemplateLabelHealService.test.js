// DB-free: the heal service's decisions that need no database - when a template counts as already checked, and that scheduling never throws or touches the DB when there is no connection.
const assert = require("node:assert/strict");
const test = require("node:test");
const heal = require("../services/TemplateLabelHealService");

test("a template is 'already checked' only for the current heal version", () => {
  assert.equal(heal.alreadyChecked({ pdfMetadata: { labelHeal: { version: heal.HEAL_VERSION } } }), true);
  assert.equal(heal.alreadyChecked({ pdfMetadata: { labelHeal: { version: heal.HEAL_VERSION - 1 } } }), false);
  assert.equal(heal.alreadyChecked({ pdfMetadata: {} }), false);
  assert.equal(heal.alreadyChecked(null), false);
});

test("scheduleHeal never throws, with a bad argument or no database connection", () => {
  assert.doesNotThrow(() => heal.scheduleHeal(null));
  assert.doesNotThrow(() => heal.scheduleHeal({}));
  assert.doesNotThrow(() => heal.scheduleHeal({ _id: "t1" }));
});

test("healTemplate reports an unreadable template instead of throwing", async () => {
  const result = await heal.healTemplate({ _id: "t1", formFields: [], formCode: "X-1" }, { dryRun: true });
  assert.equal(result.skipped, "error");
});
