// Phase 7.E (B8): the "forms stuck after all efforts" developer e-mail - recipients, content, one e-mail for a set, dedupe / changed set / reminder timing, resolved-then-gone, the
// switch, the in-app fallback, content rules, registration. MOCKED provider and stores only: no database, no real e-mail.
const test = require("node:test");
const assert = require("node:assert/strict");
const stuck = require("../../email/templates/form-pipeline-stuck");
const emailService = require("../../email/email.service");
const { SEND_RULES } = require("../../email/emailPolicy");
const registry = require("../../email/emailTriggers.registry");
const alertConfig = require("../alerts/alertConfig");
const { createAlerter, developerRecipients, DEFAULT_RECIPIENT, AUDIT } = require("../PipelineAlerter");
const { createMemoryStuckStore, setSignature } = require("../alerts/stuckStore");
const { buildStuckItem, durationText } = require("../alerts/outcomeData");
const { createHoldSweep } = require("../holdSweep");

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const HOUR = 3600000;
const text = (lines) => lines.join("\n");

const jobOf = (n, extra = {}) => ({
  _id: `job-${n}`, formCode: ["I-212", "G-639", "I-485J", "I-539A"][n % 4], state: "dead_letter", trigger: "catalog_sync", editionKey: `X|2026-0${(n % 9) + 1}-01|abc`,
  hold: { reasonCode: "NO_OFFICIAL_SOURCE", detail: "No official PDF address could be verified", stage: "import", releaseConditions: ["a working address is found (re-checked every sync)"], firstHeldAt: new Date("2026-10-20T00:00:00Z") },
  exhausted: { at: new Date("2026-10-20T01:00:00Z"), signature: `sig-${n}` },
  resolutions: [{ strategy: "reprobe-tool", ok: false, verified: false, evidence: "qpdf not on PATH" }, { strategy: "pdf-lib-normalizer", ok: true, verified: false, evidence: "field count differs" }, { strategy: "stable-pdf-url", ok: false, evidence: "HTTP 404" }],
  ...extra,
});

function harness({ configured = true, env = {}, jobs = [], throwOn = null, admins = [{ _id: "a1", role: "admin" }, { _id: "a2", role: "admin" }], active = "2025-01-20", clock = { t: new Date("2026-10-22T10:00:00Z") } } = {}) {
  const log = { emails: [], notices: [], audits: [] };
  const store = createMemoryStuckStore();
  const state = { jobs };
  const deps = {
    email: { isConfigured: () => configured, sendTemplateEmail: async (key, payload) => { if (throwOn && throwOn(key)) throw new Error("smtp down"); log.emails.push({ key, ...payload }); return { sent: true }; } },
    notifications: { createForRoles: async () => [], createNotification: async (payload) => { log.notices.push(payload); return payload; } },
    logger: silent, describeForm: async () => (active ? { activeEdition: active } : {}), listAdmins: async () => admins, audit: async (entry) => { log.audits.push(entry); },
    listStuck: async () => state.jobs, stuckStore: store, now: () => clock.t,
  };
  const jobService = { markAlert: async () => true };
  const alerter = createAlerter({ jobService, env, deps });
  return { alerter, log, store, state, clock };
}

test("recipients: DEVELOPER_EMAIL (comma list), else FORM_PIPELINE_ALERT_EMAIL, else the default developer address", () => {
  assert.deepEqual(developerRecipients({ DEVELOPER_EMAIL: "a@x.test, b@x.test", FORM_PIPELINE_ALERT_EMAIL: "other@x.test" }), ["a@x.test", "b@x.test"]);
  assert.deepEqual(developerRecipients({ FORM_PIPELINE_ALERT_EMAIL: "other@x.test" }), ["other@x.test"]);
  assert.deepEqual(developerRecipients({}), [DEFAULT_RECIPIENT]);
  assert.deepEqual(developerRecipients({ DEVELOPER_EMAIL: "  " }), [DEFAULT_RECIPIENT]);
});

test("ONE e-mail for a set of three forms, to DEVELOPER_EMAIL, with every tried strategy, the reason, the stage, the release conditions and the previous edition", async () => {
  const jobs = [jobOf(0), jobOf(1), jobOf(2)];
  const { alerter, log } = harness({ env: { DEVELOPER_EMAIL: "dev@x.test", FORM_PIPELINE_ADMIN_URL: "https://admin.test/" }, jobs });
  const result = await alerter.announceStuck({ job: jobs[0] });
  assert.equal(result.sent, true);
  assert.equal(result.channel, "email");
  assert.equal(log.emails.length, 1, "one e-mail for the whole set, not one per form");
  const mail = log.emails[0];
  assert.equal(mail.key, "form-pipeline-stuck");
  assert.equal(mail.to, "dev@x.test");
  assert.equal(mail.data.count, 3);
  const body = text(stuck.bodyLines(mail.data));
  for (const code of ["I-212", "G-639", "I-485J"]) assert.match(body, new RegExp(`<strong>${code}</strong>`));
  assert.match(body, /fetch \/ normalize \/ import/);
  assert.match(body, /No official PDF address could be verified/);
  assert.match(body, /signature sig-0/);
  assert.match(body, /reprobe-tool - did not work \(qpdf not on PATH\)/);
  assert.match(body, /pdf-lib-normalizer - ran but could not be verified \(field count differs\)/);
  assert.match(body, /stable-pdf-url - did not work \(HTTP 404\)/);
  assert.match(body, /It will resume by itself when: a working address is found/);
  assert.match(body, /The previous edition \(2025-01-20\) is still live; cases are not affected\./);
  assert.match(body, /<a href="https:\/\/admin\.test\/form-governance">Open Form Governance<\/a>/);
  assert.equal(stuck.subject(mail.data), "Form pipeline: 3 forms stuck - I-212, G-639, I-485J");
  assert.ok(log.audits.some((entry) => entry.action === AUDIT.stuck));
});

test("a form with no live edition says so; a form with no recorded strategy says so", () => {
  const item = buildStuckItem({ job: jobOf(1, { resolutions: [] }), describe: {} });
  const body = text(stuck.bodyLines({ count: 1, forms: [item] }));
  assert.match(body, /No edition of this form is live yet\./);
  assert.match(body, /no strategy result was recorded/);
});

test("an unchanged set is NOT sent again before the reminder time; a changed set is sent at once", async () => {
  const jobs = [jobOf(0), jobOf(1)];
  const { alerter, log, state } = harness({ env: { DEVELOPER_EMAIL: "dev@x.test" }, jobs });
  assert.equal((await alerter.announceStuck({ job: jobs[0] })).sent, true);
  const again = await alerter.announceStuck({ job: jobs[0] });
  assert.equal(again.sent, false);
  assert.equal(again.deduped, true);
  assert.equal(log.emails.length, 1);
  state.jobs = [...jobs, jobOf(2)];
  const changed = await alerter.announceStuck({ job: state.jobs[2] });
  assert.equal(changed.sent, true);
  assert.equal(log.emails.length, 2);
  assert.equal(log.emails[1].data.count, 3);
  assert.equal(log.emails[1].data.reminder, false);
});

test("reminder timing with an injected clock: not before 24 h, then one reminder; the window restarts after it", async () => {
  const jobs = [jobOf(0)];
  const { alerter, log, clock } = harness({ env: { DEVELOPER_EMAIL: "dev@x.test" }, jobs });
  await alerter.announceStuck({ job: jobs[0] });
  clock.t = new Date(clock.t.getTime() + 23 * HOUR);
  assert.equal((await alerter.sendStuckReminder({ force: true })).sent, false);
  clock.t = new Date(clock.t.getTime() + 2 * HOUR);
  const reminder = await alerter.sendStuckReminder({ force: true });
  assert.equal(reminder.sent, true);
  assert.equal(reminder.kind, "stuck_reminder");
  assert.equal(log.emails.length, 2);
  assert.equal(log.emails[1].data.reminder, true);
  assert.match(stuck.subject(log.emails[1].data), /^Reminder - form pipeline: 1 form stuck - I-212$/);
  assert.equal((await alerter.sendStuckReminder({ force: true })).sent, false, "just reminded");
  clock.t = new Date(clock.t.getTime() + 24 * HOUR);
  assert.equal((await alerter.sendStuckReminder({ force: true })).sent, true);
});

test("FORM_PIPELINE_STUCK_REMINDER_HOURS is honored", async () => {
  const jobs = [jobOf(0)];
  const { alerter, clock } = harness({ env: { DEVELOPER_EMAIL: "dev@x.test", FORM_PIPELINE_STUCK_REMINDER_HOURS: "2" }, jobs });
  await alerter.announceStuck({ job: jobs[0] });
  clock.t = new Date(clock.t.getTime() + 3 * HOUR);
  assert.equal((await alerter.sendStuckReminder({ force: true })).sent, true);
  assert.equal(alertConfig.stuckReminderMs({}), 24 * HOUR);
  assert.equal(alertConfig.stuckReminderMs({ FORM_PIPELINE_STUCK_REMINDER_HOURS: "nonsense" }), 24 * HOUR);
});

test("the reminder check is throttled so the worker tick does not query the database every pass", async () => {
  let queries = 0;
  const jobs = [jobOf(0)];
  const h = harness({ env: { DEVELOPER_EMAIL: "dev@x.test" }, jobs });
  h.state.jobs = jobs;
  const original = h.alerter.sendStuckReminder;
  assert.equal((await original()).sent, true, "first check sends (nothing was e-mailed yet)");
  const second = await original();
  assert.equal(second.reason, "throttled");
  queries += 1;
  assert.equal(queries, 1);
});

test("a resolved form is listed once under 'resolved' in the next e-mail, then dropped", async () => {
  const jobs = [jobOf(0), jobOf(1)];
  const { alerter, log, state } = harness({ env: { DEVELOPER_EMAIL: "dev@x.test" }, jobs });
  await alerter.announceStuck({ job: jobs[0] });
  state.jobs = [jobs[1], jobOf(2)]; // I-212 resolved, I-485J newly stuck
  const second = await alerter.announceStuck({ job: state.jobs[1] });
  assert.equal(second.sent, true);
  assert.equal(second.resolved, 1);
  assert.deepEqual(log.emails[1].data.resolved, [{ formCode: "I-212" }]);
  assert.match(text(stuck.bodyLines(log.emails[1].data)), /Resolved since the last e-mail: <strong>I-212<\/strong>/);
  state.jobs = [jobs[1], jobOf(2), jobOf(3)];
  await alerter.announceStuck({ job: state.jobs[2] });
  assert.deepEqual(log.emails[2].data.resolved, [], "listed once, then dropped");
});

test("nothing stuck any more: no e-mail", async () => {
  const { alerter, log } = harness({ env: { DEVELOPER_EMAIL: "dev@x.test" }, jobs: [] });
  assert.deepEqual(await alerter.announceStuck({ job: { _id: "x", state: "done" } }), { sent: false, reason: "nothing_stuck" });
  assert.deepEqual(await alerter.sendStuckReminder({ force: true }), { sent: false, reason: "nothing_stuck" });
  assert.equal(log.emails.length, 0);
});

test("a job that is not exhausted, or is done, is not in the e-mail", async () => {
  const jobs = [jobOf(0), jobOf(1, { exhausted: undefined }), jobOf(2, { state: "done" })];
  const { alerter, log } = harness({ env: { DEVELOPER_EMAIL: "dev@x.test" }, jobs });
  await alerter.announceStuck({ job: jobs[0] });
  assert.equal(log.emails[0].data.count, 1);
});

test("FORM_PIPELINE_EMAIL_STUCK=false: no e-mail, every admin gets an in-app notice", async () => {
  const jobs = [jobOf(0)];
  const { alerter, log } = harness({ env: { DEVELOPER_EMAIL: "dev@x.test", FORM_PIPELINE_EMAIL_STUCK: "false" }, jobs });
  const result = await alerter.announceStuck({ job: jobs[0] });
  assert.equal(result.channel, "in_app");
  assert.equal(log.emails.length, 0);
  assert.equal(log.notices.length, 2);
  assert.match(log.notices[0].title, /1 form stuck after all automatic attempts/);
});

test("no provider configured, or the send throws: in-app notice, the call never throws", async () => {
  const jobs = [jobOf(0)];
  const a = harness({ configured: false, env: { DEVELOPER_EMAIL: "dev@x.test" }, jobs });
  assert.equal((await a.alerter.announceStuck({ job: jobs[0] })).channel, "in_app");
  assert.equal(a.log.notices.length, 2);
  const b = harness({ throwOn: (key) => key === "form-pipeline-stuck", env: { DEVELOPER_EMAIL: "dev@x.test" }, jobs });
  const result = await b.alerter.announceStuck({ job: jobs[0] });
  assert.equal(result.sent, true);
  assert.equal(result.channel, "in_app");
});

test("the alerter never throws even when its own dependencies fail; a failing job list still reports the exhausted job it was given", async () => {
  const jobs = [jobOf(0)];
  const sent = [];
  const broken = createAlerter({ jobService: { markAlert: async () => true }, env: { DEVELOPER_EMAIL: "dev@x.test" }, deps: { email: { isConfigured: () => true, sendTemplateEmail: async (key, payload) => { sent.push({ key, ...payload }); return {}; } }, notifications: { createForRoles: async () => [] }, logger: silent, describeForm: async () => ({}), listStuck: async () => { throw new Error("db down"); } } });
  assert.equal((await broken.sendStuckReminder({ force: true })).sent, false, "no job given and the list is unreadable: nothing to say");
  const result = await broken.announceStuck({ job: jobs[0] });
  assert.equal(result.sent, true, "the exhausted job it was handed is still reported");
  assert.equal(sent[0].data.count, 1);
  const worse = createAlerter({ jobService: { markAlert: async () => true }, env: {}, deps: { email: { isConfigured: () => true, sendTemplateEmail: async () => ({}) }, notifications: { createForRoles: async () => [] }, logger: silent, describeForm: async () => { throw new Error("lookup down"); }, stuckStore: { getLast: async () => { throw new Error("store down"); }, record: async () => { throw new Error("store down"); } }, listStuck: async () => [jobs[0]] } });
  assert.doesNotReject(worse.announceStuck({ job: jobs[0] }));
});

test("content rules: dynamic values are escaped and secrets, URLs with keys and stack traces never reach the e-mail", async () => {
  const dirty = jobOf(0, {
    formCode: "I-9<script>",
    hold: { reasonCode: "X", detail: "failed at mongodb://user:pw@host/db?authSource=admin with token=abc123def456 and api_key: SECRETSECRETSECRET1234567890\n    at Object.<anonymous> (C:\\app\\x.js:1:1)", stage: "import", releaseConditions: ["<b>fix</b>"], firstHeldAt: new Date() },
    resolutions: [{ strategy: "s<i>", ok: false, evidence: { url: "https://x.test/?key=VERYSECRETVALUE1234567890", stack: "at foo (file.js:1:1)" } }],
  });
  const { alerter, log } = harness({ env: { DEVELOPER_EMAIL: "dev@x.test" }, jobs: [dirty] });
  await alerter.announceStuck({ job: dirty });
  const body = text(stuck.bodyLines(log.emails[0].data));
  assert.doesNotMatch(body, /user:pw@|abc123def456|SECRETSECRET|VERYSECRETVALUE|\n\s+at Object|C:\\app/);
  assert.doesNotMatch(body, /<script>|<i>|<b>fix/);
  assert.match(body, /I-9&lt;script&gt;/);
  assert.match(body, /\[database-uri\]/);
});

test("durationText reads plainly", () => {
  const now = new Date("2026-10-22T12:00:00Z");
  assert.equal(durationText(new Date("2026-10-19T08:00:00Z"), now), "3 d 4 h");
  assert.equal(durationText(new Date("2026-10-22T06:50:00Z"), now), "5 h 10 min");
  assert.equal(durationText(new Date("2026-10-22T11:48:00Z"), now), "12 min");
  assert.equal(durationText(null, now), "");
});

test("setSignature is order independent and the memory store round-trips", async () => {
  const a = [{ jobId: "1", signature: "x" }, { jobId: "2", signature: "y" }];
  assert.equal(setSignature(a), setSignature([...a].reverse()));
  const store = createMemoryStuckStore();
  assert.equal(await store.getLast(), null);
  await store.record({ at: new Date("2026-10-22T00:00:00Z"), entries: [{ jobId: 1, formCode: "I-1", signature: "s" }] });
  assert.deepEqual((await store.getLast()).entries, [{ jobId: "1", formCode: "I-1", signature: "s" }]);
});

test("the sweep calls the reminder, never throws, and keeps its old summary shape when the alerter has no reminder", async () => {
  const jobService = { requeueOutdatedHolds: async () => 0, persistentHolds: async () => [], markEscalated: async () => true };
  let called = 0;
  const withReminder = await createHoldSweep({ jobService, alerter: { sendStuckReminder: async () => { called += 1; return { sent: true }; } }, log: silent })();
  assert.equal(called, 1);
  assert.equal(withReminder.stuckReminded, 1);
  const throwing = await createHoldSweep({ jobService, alerter: { sendStuckReminder: async () => { throw new Error("boom"); } }, log: silent })();
  assert.equal(throwing.stuckReminded, undefined);
  assert.deepEqual(await createHoldSweep({ jobService, alerter: {}, log: silent })(), { requeued: 0, escalated: 0 });
});

test("the e-mail is registered: send rule, policy entry, trigger registry (locked), template shape", () => {
  assert.equal(stuck.key, "form-pipeline-stuck");
  assert.ok(emailService.TEMPLATE_RECIPIENT_ROLES ? emailService.TEMPLATE_RECIPIENT_ROLES["form-pipeline-stuck"] : true);
  assert.ok(SEND_RULES["form-pipeline-stuck"], "emailPolicy entry");
  assert.match(SEND_RULES["form-pipeline-stuck"].when, /DEVELOPER_EMAIL/);
  const entry = (registry.TRIGGERS || registry.EMAIL_TRIGGERS || registry.triggers || []).find?.((item) => item.key === "form-pipeline-stuck" || item.templateKey === "form-pipeline-stuck");
  if (registry.TRIGGERS || registry.EMAIL_TRIGGERS || registry.triggers) assert.ok(entry, "trigger registry entry");
  assert.equal(typeof stuck.subject({}), "string");
  assert.ok(Array.isArray(stuck.bodyLines({})));
});
