// Delayed, never skipped: a client who has not set a password gets their e-mails held, then released one a minute apart.
const test = require("node:test");
const assert = require("node:assert/strict");
const { planRelease, dedupeKeyFor, SPACING_MS } = require("../deferredEmail.service");
const { emailDecision } = require("../../notifications/triggerEvents.service");

test("release plan: oldest first, the first now and each next one a minute later", () => {
  const now = new Date("2026-11-12T10:00:00Z");
  const plan = planRelease([
    { _id: "c", createdAt: "2026-11-12T09:03:00Z" },
    { _id: "a", createdAt: "2026-11-12T09:01:00Z" },
    { _id: "b", createdAt: "2026-11-12T09:02:00Z" },
  ], now);
  assert.deepEqual(plan.map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(plan.map((entry) => entry.sendAfter.toISOString()), ["2026-11-12T10:00:00.000Z", "2026-11-12T10:01:00.000Z", "2026-11-12T10:02:00.000Z"]);
  assert.equal(SPACING_MS, 60000);
  assert.deepEqual(planRelease([], now), []);
});

test("an identical e-mail (person, template, case, event, content) is held once; different content is held separately", () => {
  const base = { userId: "u1", templateKey: "questionnaire-assigned", caseId: "c1", event: "questionnaire.assigned" };
  assert.equal(dedupeKeyFor({ ...base, data: { questionnaireName: "A" } }), dedupeKeyFor({ ...base, data: { questionnaireName: "A" } }));
  assert.notEqual(dedupeKeyFor({ ...base, data: { questionnaireName: "A" } }), dedupeKeyFor({ ...base, data: { questionnaireName: "B" } }));
});

test("a client who has not set a password is DEFERRED (held), never silently skipped; real skips stay skips", () => {
  const trigger = { event: "questionnaire.assigned", audience: "client", emailAuto: true };
  const ctx = {};
  assert.deepEqual(emailDecision(trigger, { email: "x@acme.com" }, null, ctx), { send: false, defer: true, reason: "account_not_activated" });
  assert.deepEqual(emailDecision(trigger, { email: "x@acme.com", password: "hash" }, null, ctx), { send: true });
  // reasons that are real decisions are not deferred
  assert.equal(emailDecision(trigger, { email: "x@acme.com" }, { sendEmail: false }, ctx).defer, undefined);
  assert.equal(emailDecision(trigger, { email: "x@acme.com", isDemoData: true }, null, ctx).defer, undefined);
  assert.equal(emailDecision({ ...trigger, emailAuto: false }, { email: "x@acme.com" }, null, ctx).defer, undefined);
  // other audiences are unchanged
  assert.deepEqual(emailDecision({ ...trigger, audience: "employee" }, { email: "x@acme.com" }, null, ctx), { send: true });
});
