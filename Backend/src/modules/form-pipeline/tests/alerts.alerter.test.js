// Phase 5E: the alerter's success / held / digest behavior with a MOCKED mail provider, a fake job store and an in-memory digest store - no database, no real e-mail.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAlerter, AUDIT } = require("../PipelineAlerter");
const { createMemoryDigestStore } = require("../alerts/digestStore");

const silent = { info() {}, warn() {}, error() {}, debug() {} };

function harness({ configured = true, env = {}, admins = null, throwOn = null, auditThrows = false } = {}) {
  const log = { emails: [], notices: [], roleNotices: [], audits: [], marks: new Map() };
  let digestStore = createMemoryDigestStore();
  const jobService = { markAlert: async (jobId, signature) => { const seen = log.marks.get(String(jobId)) || new Set(); if (seen.has(signature)) return false; seen.add(signature); log.marks.set(String(jobId), seen); return true; } };
  const deps = {
    email: { isConfigured: () => configured, sendTemplateEmail: async (key, payload) => { if (throwOn && throwOn(key)) throw new Error("smtp down"); log.emails.push({ key, ...payload }); return { sent: true }; } },
    notifications: {
      createForRoles: async (roles, payload) => { log.roleNotices.push({ roles, ...payload }); return []; },
      createNotification: async (payload) => { log.notices.push(payload); return payload; },
    },
    logger: silent,
    describeForm: async () => ({ activeEdition: "2024-04-01" }),
    digestStore,
    listAdmins: admins ? async () => admins : null,
    audit: async (entry) => { if (auditThrows) throw new Error("audit down"); log.audits.push(entry); },
    outcomeLookups: { visaTypes: async () => ["CR-1", "IR-1"], coverage: async () => ({ total: 300, mapped: 292, requiredUnmapped: 1 }) },
  };
  const alerter = createAlerter({ jobService, env, deps });
  return { alerter, log, store: digestStore };
}

let jobCounter = 0;
const makeJob = (trigger = "admin_fetch", formCode = "I-130", extra = {}) => ({ _id: `job-${++jobCounter}`, formCode, trigger, editionKey: `${formCode}|2025-01-20|abc`, attempts: 1, maxAttempts: 5, ...extra });
const promoted = (formCode = "I-130", extra = {}) => ({
  outcome: { status: "activated", version: "2025-01-20" },
  result: { template: { formCode, status: "active", version: "2025-01-20", editionDate: "2025-01-20T00:00:00.000Z" }, previousTemplate: { version: "2024-04-01", editionDate: "2024-04-01T00:00:00.000Z" }, versionChanged: true, requiresActivation: false, ...extra },
});

test("an on-demand success sends ONE e-mail with the plan's facts to the configured recipients, and is audited", async () => {
  const { alerter, log } = harness({ env: { FORM_PIPELINE_ALERT_EMAIL: "dev@x.test, ops@x.test", FORM_PIPELINE_ADMIN_URL: "https://admin.test/" } });
  const job = makeJob("admin_fetch");
  const result = await alerter.announceOutcome({ job, ...promoted() });
  assert.deepEqual([result.sent, result.kind, result.route, result.channel], [true, "success", "individual", "email"]);
  assert.deepEqual(log.emails.map((mail) => [mail.key, mail.to]), [["form-pipeline-success", "dev@x.test"], ["form-pipeline-success", "ops@x.test"]]);
  const data = log.emails[0].data;
  assert.deepEqual([data.formCode, data.previousEdition, data.newEdition, data.visaTypes, data.release.mode, data.previousRetained], ["I-130", "2024-04-01", "2025-01-20", ["CR-1", "IR-1"], "promoted", true]);
  assert.deepEqual(data.coverage, { total: 300, mapped: 292, requiredUnmapped: 1 });
  assert.equal(data.adminLink, "https://admin.test/form-governance");
  assert.equal(log.audits.length, 1);
  assert.deepEqual([log.audits[0].action, log.audits[0].entityType, log.audits[0].entityId], [AUDIT.alert, "FormPipelineJob", job._id]);
});

test("a degraded release is reported with the failed checks and the authorizer", async () => {
  const { alerter, log } = harness();
  const info = promoted("I-90");
  info.result.template.lifecycle = { certificationOverride: { failed: [{ name: "viewer_render" }, "download"], by: "u9", at: "2026-02-03T00:00:00Z", reason: "cosmetic" } };
  await alerter.announceOutcome({ job: makeJob("admin_fetch", "I-90"), ...info });
  assert.deepEqual(log.emails[0].data.release, { mode: "degraded", failed: ["viewer_render", "download"], authorizedBy: "u9", authorizedAt: "2026-02-03", reason: "cosmetic" });
});

test("the same success is announced once per job and edition", async () => {
  const { alerter, log } = harness();
  const job = makeJob("admin_fetch");
  assert.equal((await alerter.announceOutcome({ job, ...promoted() })).sent, true);
  const again = await alerter.announceOutcome({ job, ...promoted() });
  assert.deepEqual([again.sent, again.deduped], [false, true]);
  assert.equal(log.emails.length, 1);
});

test("scheduled runs collect successes into ONE digest that is sent after the quiet period; it is not sent twice", async () => {
  const { alerter, log, store } = harness();
  for (const code of ["I-130", "I-485", "I-765"]) {
    const result = await alerter.announceOutcome({ job: makeJob("catalog_sync", code), ...promoted(code) });
    assert.deepEqual([result.sent, result.route], [false, "digest"]);
  }
  assert.equal(log.emails.length, 0, "no per-form e-mails for a catalog sync");
  assert.equal((await alerter.flushDigests()).flushed, 0, "not quiet long enough yet");
  const later = new Date(Date.now() + 11 * 60 * 1000);
  assert.equal((await alerter.flushDigests({ now: later })).flushed, 1);
  assert.equal(log.emails.length, 1);
  assert.equal(log.emails[0].key, "form-pipeline-digest");
  assert.deepEqual([log.emails[0].data.count, log.emails[0].data.trigger, log.emails[0].data.entries.map((item) => item.formCode)], [3, "catalog_sync", ["I-130", "I-485", "I-765"]]);
  assert.deepEqual(log.emails[0].data.entries[0], { formCode: "I-130", fromEdition: "2024-04-01", toEdition: "2025-01-20", release: "promoted" });
  assert.equal((await alerter.flushDigests({ now: later })).flushed, 0, "a sent digest is never sent again");
  assert.equal(store.windows.filter((item) => item.state === "sent").length, 1);
  assert.equal(log.audits.filter((entry) => entry.action === AUDIT.digest).length, 1);
});

test("per-run cap: individual e-mails up to the cap, the rest go into the digest (which says how many were already sent)", async () => {
  const { alerter, log } = harness({ env: { FORM_PIPELINE_EMAIL_MODE: "individual", FORM_PIPELINE_EMAIL_RUN_CAP: "2" } });
  const routes = [];
  for (const code of ["A-1", "A-2", "A-3", "A-4"]) routes.push((await alerter.announceOutcome({ job: makeJob("catalog_sync", code), ...promoted(code) })).route);
  assert.deepEqual(routes, ["individual", "individual", "digest", "digest"]);
  assert.equal(log.emails.filter((mail) => mail.key === "form-pipeline-success").length, 2);
  await alerter.flushDigests({ now: new Date(Date.now() + 11 * 60 * 1000) });
  const digest = log.emails.find((mail) => mail.key === "form-pipeline-digest");
  assert.deepEqual([digest.data.count, digest.data.individualSent, digest.data.entries.map((item) => item.formCode)], [2, 2, ["A-3", "A-4"]]);
});

test("digest mode sends even an on-demand success to the digest; a cap of 0 sends none individually", async () => {
  const digestMode = harness({ env: { FORM_PIPELINE_EMAIL_MODE: "digest" } });
  assert.equal((await digestMode.alerter.announceOutcome({ job: makeJob("admin_fetch"), ...promoted() })).route, "digest");
  const noCap = harness({ env: { FORM_PIPELINE_EMAIL_RUN_CAP: "0" } });
  assert.equal((await noCap.alerter.announceOutcome({ job: makeJob("admin_fetch"), ...promoted() })).route, "digest");
  assert.equal(digestMode.log.emails.length + noCap.log.emails.length, 0);
});

test("toggles: success off sends nothing at all; held off and failure off fall back to the in-app notice", async () => {
  const off = harness({ env: { FORM_PIPELINE_EMAIL_SUCCESS: "false" } });
  const skipped = await off.alerter.announceOutcome({ job: makeJob("admin_fetch"), ...promoted() });
  assert.deepEqual([skipped.sent, skipped.reason], [false, "switched_off"]);
  assert.equal(off.log.emails.length + off.log.notices.length + off.log.roleNotices.length, 0);
  await off.alerter.announceOutcome({ job: makeJob("catalog_sync"), ...promoted() });
  assert.equal(off.store.windows.length, 0, "nothing is even collected for the digest");

  const heldOff = harness({ env: { FORM_PIPELINE_EMAIL_HELD: "false" } });
  const held = await heldOff.alerter.announce({ job: makeJob("catalog_sync"), transition: { state: "held", signature: "promote|held|EDITION_POLICY_HELD", classification: { class: "held", code: "EDITION_POLICY_HELD" }, message: "not accepted" }, stage: "promote", result: {} });
  assert.deepEqual([held.sent, held.kind, held.channel], [true, "held", "in_app"]);
  assert.equal(heldOff.log.emails.length, 0);
  assert.equal(heldOff.log.roleNotices[0].type, "form_pipeline_alert");

  const failOff = harness({ env: { FORM_PIPELINE_EMAIL_FAILURE: "false" } });
  const failed = await failOff.alerter.announce({ job: makeJob("catalog_sync"), transition: { state: "pending", signature: "import|transient|HTTP_502", classification: { class: "transient", code: "HTTP_502" }, message: "Bad Gateway" }, stage: "import" });
  assert.equal(failed.channel, "in_app");
  assert.equal(failOff.log.emails.length, 0);
});

test("a policy HOLD sends one held e-mail with the reason and the action; the same hold again is deduped", async () => {
  const { alerter, log } = harness();
  const job = makeJob("catalog_sync", "I-485", { editionKey: "I-485|2026-09-18|abc" });
  const transition = { state: "held", signature: "promote|held|EDITION_POLICY_HELD", classification: { class: "held", code: "EDITION_POLICY_HELD" }, message: "USCIS has not confirmed that edition 2026-09-18 is accepted" };
  const first = await alerter.announce({ job, transition, stage: "promote", result: { activationBlockedReason: transition.message } });
  assert.deepEqual([first.sent, first.kind, first.channel], [true, "held", "email"]);
  assert.equal(log.emails[0].key, "form-pipeline-held");
  assert.deepEqual([log.emails[0].data.formCode, log.emails[0].data.editionDate, log.emails[0].data.reasonKind, log.emails[0].data.activeEdition], ["I-485", "2026-09-18", "policy_hold", "2024-04-01"]);
  assert.match(log.emails[0].data.reason, /has not confirmed/);
  assert.match(log.emails[0].data.action, /acceptance evidence/);
  assert.equal((await alerter.announce({ job, transition, stage: "promote", result: {} })).deduped, true);
  assert.equal(log.emails.length, 1);
});

test("an edition left in review (approval required) sends a held e-mail once per job, edition and reason; other statuses send nothing", async () => {
  const { alerter, log } = harness();
  const job = makeJob("admin_fetch", "I-129");
  const outcome = { status: "kept_in_review", activationBlockedReason: "Mapping review is required before activation" };
  const result = { template: { version: "2024-04-01" }, requiresActivation: true, activationBlockedReason: outcome.activationBlockedReason, versionChanged: true };
  const first = await alerter.announceOutcome({ job, outcome, result });
  assert.deepEqual([first.sent, first.kind, first.reason], [true, "held", "approval_required"]);
  assert.equal(log.emails[0].key, "form-pipeline-held");
  assert.deepEqual([log.emails[0].data.reasonKind, log.emails[0].data.reason], ["approval_required", "Mapping review is required before activation"]);
  assert.equal((await alerter.announceOutcome({ job, outcome, result })).deduped, true);
  for (const status of ["no_change", "skipped", "uscis_unreachable", "no_result"]) assert.equal((await alerter.announceOutcome({ job: makeJob(), outcome: { status }, result: {} })).sent, false, status);
  assert.equal(log.emails.length, 1);
});

test("no provider: the admins get ONE in-app notification each, with its own dedupeKey (a shared key would collapse the fan-out)", async () => {
  const admins = [{ _id: "u1", role: "admin" }, { _id: "u2", role: "super_admin" }, { _id: "u3", role: "admin" }];
  const { alerter, log } = harness({ configured: false, admins });
  const job = makeJob("admin_fetch");
  const result = await alerter.announceOutcome({ job, ...promoted() });
  assert.deepEqual([result.sent, result.channel], [true, "in_app"]);
  assert.equal(log.emails.length, 0);
  assert.deepEqual(log.notices.map((notice) => notice.userId), ["u1", "u2", "u3"]);
  assert.equal(new Set(log.notices.map((notice) => notice.dedupeKey)).size, 3, "every admin has a distinct dedupeKey");
  assert.ok(log.notices.every((notice) => notice.dedupeKey.startsWith(`form-pipeline:${job._id}:`) && notice.dedupeKey.endsWith(`:${notice.userId}`)));
  assert.deepEqual([log.notices[0].type, log.notices[0].recipientRole, log.notices[0].category], ["form_pipeline_update", "admin", "system"]);
  assert.equal(log.roleNotices.length, 0);
  // failures use the registered alert type
  const failed = harness({ configured: false, admins });
  await failed.alerter.announce({ job: makeJob("catalog_sync"), transition: { state: "blocked", signature: "import|blocked|X", classification: { class: "blocked", code: "X" }, message: "bad pdf" }, stage: "import" });
  assert.equal(failed.log.notices[0].type, "form_pipeline_alert");
  assert.equal(failed.log.notices[0].priority, "high");
});

test("without a per-user path the fan-out falls back to the role call WITHOUT a dedupeKey", async () => {
  const { alerter, log } = harness({ configured: false });
  await alerter.announceOutcome({ job: makeJob("admin_fetch"), ...promoted() });
  assert.deepEqual(log.roleNotices[0].roles, ["super_admin", "admin"]);
  assert.equal(log.roleNotices[0].dedupeKey, undefined);
});

test("a provider failure never throws: the e-mail falls back to the in-app notice; an audit failure is swallowed", async () => {
  const broken = harness({ throwOn: () => true, admins: [{ _id: "u1", role: "admin" }] });
  const result = await broken.alerter.announceOutcome({ job: makeJob("admin_fetch"), ...promoted() });
  assert.deepEqual([result.sent, result.channel], [true, "in_app"]);
  assert.equal(broken.log.notices.length, 1);
  const noAudit = harness({ auditThrows: true });
  assert.equal((await noAudit.alerter.announceOutcome({ job: makeJob("admin_fetch"), ...promoted() })).sent, true);
  // the job store itself failing is reported, not thrown
  const alerter = createAlerter({ jobService: { markAlert: async () => { throw new Error("db down"); } }, deps: { email: { isConfigured: () => true, sendTemplateEmail: async () => ({}) }, notifications: { createForRoles: async () => [] }, logger: silent } });
  const failed = await alerter.announceOutcome({ job: makeJob(), ...promoted() });
  assert.deepEqual([failed.sent, failed.error], [false, "db down"]);
});

test("a digest that cannot be sent is put back and sent by a later tick", async () => {
  let fail = true;
  const { alerter, log, store } = harness({ throwOn: (key) => fail && key === "form-pipeline-digest" });
  await alerter.announceOutcome({ job: makeJob("catalog_sync"), ...promoted() });
  const later = new Date(Date.now() + 11 * 60 * 1000);
  // the e-mail fails, the in-app fallback (role fan-out) still tells the admins and the window is marked sent
  assert.equal((await alerter.flushDigests({ now: later })).flushed, 1);
  assert.equal(log.roleNotices.length, 1);
  assert.equal(log.roleNotices[0].type, "form_pipeline_update");
  fail = false;
  assert.equal(store.windows[0].state, "sent");
  // when even the in-app path throws the window is released (not lost)
  const dead = harness({ throwOn: () => true });
  dead.alerter = createAlerter({
    jobService: { markAlert: async () => true },
    deps: { email: { isConfigured: () => true, sendTemplateEmail: async () => { throw new Error("smtp down"); } }, notifications: { createForRoles: async () => { throw new Error("notify down"); } }, logger: silent, digestStore: dead.store },
  });
  await dead.alerter.announceOutcome({ job: makeJob("catalog_sync"), ...promoted() });
  assert.equal((await dead.alerter.flushDigests({ now: later })).flushed, 0);
  assert.equal(dead.store.windows[0].state, "open", "released for the next tick");
});

test("bodies carry the sanitized message only: no secret, token, connection string or stack trace", async () => {
  const { alerter, log } = harness();
  const { sanitizeMessage } = require("../errorClassifier");
  const dirty = "Bad Gateway key=SECRET123 token: abcdef mongodb://user:pass@host/db\n    at Object.<anonymous> (/srv/app.js:1:1)";
  await alerter.announce({ job: makeJob("catalog_sync", "I-485"), transition: { state: "held", signature: "promote|held|X", classification: { class: "held", code: "X" }, message: sanitizeMessage(dirty) }, stage: "promote", result: { activationBlockedReason: dirty } });
  const serialized = JSON.stringify(log.emails[0].data);
  for (const secret of ["SECRET123", "abcdef", "user:pass", "at Object", "app.js"]) assert.equal(serialized.includes(secret), false, secret);
});

test("existing behavior is kept: failure / blocked / dead-letter use the alert template; a quiet blocked trigger is not announced; the worker alert goes to each admin once per hour", async () => {
  const { alerter, log } = harness({ admins: [{ _id: "u1", role: "admin" }, { _id: "u2", role: "admin" }], configured: true });
  const transition = (state, code) => ({ state, signature: `import|x|${code}`, classification: { class: "transient", code }, message: "m" });
  assert.equal((await alerter.announce({ job: makeJob("catalog_sync"), transition: transition("pending", "A"), stage: "import" })).kind, "failure");
  assert.equal((await alerter.announce({ job: makeJob("catalog_sync"), transition: transition("dead_letter", "B"), stage: "import" })).kind, "dead_letter");
  assert.equal((await alerter.announce({ job: makeJob("admin_fetch"), transition: transition("blocked", "C"), stage: "import" })).reason, "user_visible");
  assert.equal((await alerter.announce({ job: makeJob(), transition: { state: "done" }, stage: "import" })).reason, "no_alert_for_state");
  assert.deepEqual(log.emails.map((mail) => mail.key), ["form-pipeline-alert", "form-pipeline-alert"]);
  assert.equal((await alerter.workerUnavailable({ waiting: [{ formCode: "I-1" }] })).sent, true);
  assert.equal((await alerter.workerUnavailable({ waiting: [{ formCode: "I-1" }] })).deduped, true);
  assert.deepEqual(log.notices.map((notice) => notice.userId), ["u1", "u2"]);
  assert.equal(new Set(log.notices.map((notice) => notice.dedupeKey)).size, 2);
});
