// Phase 5E: noise-control switches of the developer e-mails (pure, no database, no mail).
const test = require("node:test");
const assert = require("node:assert/strict");
const config = require("../alerts/alertConfig");

test("defaults: every outcome e-mail on, auto mode, cap 5, 10 quiet minutes, flusher on", () => {
  assert.deepEqual(config.emailFlags({}), { failure: true, held: true, success: true });
  assert.equal(config.emailMode({}), "auto");
  assert.equal(config.runCap({}), 5);
  assert.equal(config.digestQuietMs({}), 10 * 60 * 1000);
  assert.equal(config.flusherEnabled({}), true);
});

test("each toggle switches only its own outcome off (false / 0 / off / no, any case)", () => {
  for (const off of ["false", "FALSE", "0", "off", "no"]) {
    assert.deepEqual(config.emailFlags({ FORM_PIPELINE_EMAIL_SUCCESS: off }), { failure: true, held: true, success: false });
    assert.deepEqual(config.emailFlags({ FORM_PIPELINE_EMAIL_FAILURE: off }), { failure: false, held: true, success: true });
    assert.deepEqual(config.emailFlags({ FORM_PIPELINE_EMAIL_HELD: off }), { failure: true, held: false, success: true });
  }
  assert.deepEqual(config.emailFlags({ FORM_PIPELINE_EMAIL_SUCCESS: "", FORM_PIPELINE_EMAIL_HELD: "true" }), { failure: true, held: true, success: true }, "empty = default");
});

test("mode: unknown values fall back to auto", () => {
  assert.equal(config.emailMode({ FORM_PIPELINE_EMAIL_MODE: "DIGEST" }), "digest");
  assert.equal(config.emailMode({ FORM_PIPELINE_EMAIL_MODE: "individual" }), "individual");
  assert.equal(config.emailMode({ FORM_PIPELINE_EMAIL_MODE: "weekly" }), "auto");
});

test("cap and quiet period: invalid numbers fall back, 0 cap is allowed, quiet period is at least a minute", () => {
  assert.equal(config.runCap({ FORM_PIPELINE_EMAIL_RUN_CAP: "0" }), 0);
  assert.equal(config.runCap({ FORM_PIPELINE_EMAIL_RUN_CAP: "12" }), 12);
  assert.equal(config.runCap({ FORM_PIPELINE_EMAIL_RUN_CAP: "-3" }), 5);
  assert.equal(config.runCap({ FORM_PIPELINE_EMAIL_RUN_CAP: "many" }), 5);
  assert.equal(config.digestQuietMs({ FORM_PIPELINE_DIGEST_QUIET_MINUTES: "30" }), 30 * 60 * 1000);
  assert.equal(config.digestQuietMs({ FORM_PIPELINE_DIGEST_QUIET_MINUTES: "0" }), 10 * 60 * 1000);
  assert.equal(config.flusherEnabled({ FORM_PIPELINE_DIGEST_FLUSHER: "false" }), false);
});

test("auto mode: scheduled / catalog-wide runs go to ONE digest, on-demand runs are individual e-mails", () => {
  for (const trigger of ["catalog_sync", "autopilot", "edition_upgrade", "script"]) assert.equal(config.successRoute({ trigger, env: {} }), "digest", trigger);
  for (const trigger of ["admin_fetch", "case_acquire", "mapping_save", "manual_retry", "unknown"]) assert.equal(config.successRoute({ trigger, env: {} }), "individual", trigger);
});

test("explicit modes override the trigger", () => {
  assert.equal(config.successRoute({ trigger: "admin_fetch", env: { FORM_PIPELINE_EMAIL_MODE: "digest" } }), "digest");
  assert.equal(config.successRoute({ trigger: "catalog_sync", env: { FORM_PIPELINE_EMAIL_MODE: "individual" } }), "individual");
});

test("a digest window belongs to one trigger", () => {
  assert.equal(config.digestKey("catalog_sync"), "success:catalog_sync");
  assert.notEqual(config.digestKey("catalog_sync"), config.digestKey("autopilot"));
});
