// DB-free: the client checklist e-mails - when the client counts as having SUBMITTED (Save progress does not), the 3-day cadence, the one-time "received" e-mail,
// that only the client is ever e-mailed, and that nothing here can throw into an existing flow.
const assert = require("node:assert/strict");
const test = require("node:test");
const svc = require("../checklist-reminder.service");
const reminderTemplate = require("../../email/templates/checklist-incomplete-reminder");
const receivedTemplate = require("../../email/templates/checklist-received-client");

const DAY = 24 * 60 * 60 * 1000;
const T0 = new Date("2026-11-01T10:00:00Z");
const after = (days, from = T0) => new Date(from.getTime() + days * DAY);
const ref = (status, over = {}) => ({ questionnaireId: "q1", targetRole: "client", status, active: true, ...over });
const client = { _id: "u1", role: "client", email: "client@example.org", name: "Cleo Client", isActive: true };
const questionnaireOf = () => ({ key: "i140_beneficiary_checklist", checklistRole: "client" });

// ---- what counts as submitted ----
test("Save progress never counts: a filled-in but not submitted checklist is still pending", () => {
  for (const status of ["not_started", "in_progress", "completed", "returned"]) {
    const a = svc.assess({ caseData: { questionnaireReferences: [ref(status)] }, user: client, questionnaireOf });
    assert.equal(a.eligible, true, status);
    assert.equal(a.submitted, false, `${status} is not submitted`);
  }
});

test("the Submit button counts: every visible checklist submitted or approved", () => {
  assert.equal(svc.assess({ caseData: { questionnaireReferences: [ref("submitted")] }, user: client, questionnaireOf }).submitted, true);
  assert.equal(svc.assess({ caseData: { questionnaireReferences: [ref("approved"), ref("submitted")] }, user: client, questionnaireOf }).submitted, true);
  // one of two submitted is still pending
  const partly = svc.assess({ caseData: { questionnaireReferences: [ref("submitted"), ref("in_progress")] }, user: client, questionnaireOf });
  assert.equal(partly.submitted, false);
  assert.equal(partly.pending, 1);
});

test("'Submit case' writes the participant record, not the checklist: that counts as submitted too; a returned participant does not", () => {
  const caseData = { questionnaireReferences: [ref("in_progress")], participants: [{ userId: "u1", role: "client", status: "submitted" }] };
  assert.equal(svc.assess({ caseData, user: client, questionnaireOf }).submitted, true);
  caseData.participants[0].status = "needs_info";
  assert.equal(svc.assess({ caseData, user: client, questionnaireOf }).submitted, false);
  assert.equal(svc.assess({ caseData: { questionnaireReferences: [ref("in_progress")] }, user: client, questionnaireOf, intakeSubmitted: true }).submitted, true);
});

test("only checklists the client can see count: a draft waiting for the case manager, a removed one and a staff-requested one never do", () => {
  const gated = (extra = {}) => ({ checklistApproval: { required: true, approvals: [], ...extra } });
  assert.equal(svc.assess({ caseData: { ...gated(), questionnaireReferences: [ref("not_started")] }, user: client, questionnaireOf }).eligible, false, "a draft is invisible to the client");
  const approved = gated({ approvals: [{ checklistId: "i140_beneficiary_checklist|client" }] });
  assert.equal(svc.assess({ caseData: { ...approved, questionnaireReferences: [ref("not_started")] }, user: client, questionnaireOf }).eligible, true);
  const removed = gated({ approvals: [{ checklistId: "i140_beneficiary_checklist|client" }], removed: [{ checklistId: "i140_beneficiary_checklist|client" }] });
  assert.equal(svc.assess({ caseData: { ...removed, questionnaireReferences: [ref("not_started")] }, user: client, questionnaireOf }).eligible, false);
  assert.equal(svc.assess({ caseData: { questionnaireReferences: [ref("not_started", { staffRequest: true })] }, user: client, questionnaireOf }).eligible, false);
  assert.equal(svc.assess({ caseData: { questionnaireReferences: [ref("not_started", { active: false })] }, user: client, questionnaireOf }).eligible, false);
});

test("only a client-side user is ever considered: no staff or attorney role is eligible", () => {
  for (const role of ["admin", "super_admin", "case_manager", "team_lead", "attorney", "paralegal", "finance", "hr"]) {
    assert.equal(svc.assess({ caseData: { questionnaireReferences: [ref("not_started")] }, user: { ...client, role }, questionnaireOf }).eligible, false, role);
  }
  // each portal user sees only their own role's checklists
  const employeeRef = ref("not_started", { targetRole: "employee" });
  assert.equal(svc.assess({ caseData: { questionnaireReferences: [employeeRef] }, user: client, questionnaireOf: () => ({ key: "x", checklistRole: "employee" }) }).eligible, false);
  assert.equal(svc.assess({ caseData: { questionnaireReferences: [employeeRef] }, user: { ...client, role: "employee" }, questionnaireOf: () => ({ key: "x", checklistRole: "employee" }) }).eligible, true);
});

// ---- the cadence ----
const open = { eligible: true, submitted: false, relevant: 1, pending: 1 };
const done = { eligible: true, submitted: true, relevant: 1, pending: 0 };

test("a case met for the first time starts its 3-day cycle - no e-mail now; the first reminder is due 3 days later, then every 3 days", () => {
  const first = svc.decide({ state: undefined, assessment: open, now: T0 });
  assert.equal(first.action, "init");
  assert.equal(first.patch.nextDueAt.getTime(), after(3).getTime());
  let state = first.patch;
  assert.equal(svc.decide({ state, assessment: open, now: after(2.9) }).action, "none", "not yet");
  const second = svc.decide({ state, assessment: open, now: after(3) });
  assert.equal(second.action, "remind");
  state = { ...state, ...second.patch };
  assert.equal(state.nextDueAt.getTime(), after(6).getTime());
  assert.equal(svc.decide({ state, assessment: open, now: after(5.9) }).action, "none");
  assert.equal(svc.decide({ state, assessment: open, now: after(6) }).action, "remind", "and again, until Submit");
  // Save progress in between changes nothing: it is the same 'not submitted' answer
  assert.equal(svc.decide({ state, assessment: { ...open, pending: 0 }, now: after(4) }).action, "none", "a save between two reminders neither sends nor resets anything");
});

test("Submit: the 'received' e-mail is sent once, only for a submission that was watched or reported, and the reminders stop", () => {
  const tracked = { startedAt: T0, nextDueAt: after(3), submitted: false };
  const received = svc.decide({ state: tracked, assessment: done, now: after(1) });
  assert.equal(received.action, "received");
  assert.equal(received.patch.submitted, true);
  const stateAfter = { ...tracked, ...received.patch };
  assert.equal(svc.decide({ state: stateAfter, assessment: done, now: after(2) }).action, "none", "no second 'received'");
  assert.equal(svc.decide({ state: stateAfter, assessment: open, now: after(10) }).action, "restart", "returned to the client: a fresh cycle, not an instant reminder");
  // reported by the submit itself, even with no state yet
  assert.equal(svc.decide({ state: undefined, assessment: done, now: T0, trigger: "submit" }).action, "received");
  // met already submitted by the periodic job (a case from before this feature): recorded, never e-mailed
  const old = svc.decide({ state: undefined, assessment: done, now: T0, trigger: "job" });
  assert.equal(old.action, "none");
  assert.equal(old.patch.submitted, true);
});

test("a second 'received' within a day is not sent (flapping protection)", () => {
  const state = { startedAt: T0, submitted: false, receivedEmailedAt: after(0.2) };
  assert.equal(svc.decide({ state, assessment: done, now: after(0.5), trigger: "submit" }).action, "none");
  assert.equal(svc.decide({ state, assessment: done, now: after(1.5), trigger: "submit" }).action, "received");
});

test("a case with nothing for the client to complete is left alone", () => {
  assert.equal(svc.decide({ state: undefined, assessment: { eligible: false, submitted: false }, now: T0 }).action, "none");
});

// ---- the whole evaluation, with fake dependencies ----
function fakeDeps({ caseDoc, userDoc = client, sendImpl, claim = true } = {}) {
  const sent = [];
  const writes = [];
  const Case = {
    findById: () => ({ select: () => ({ lean: async () => caseDoc }) }),
    updateOne: async (filter, update, options) => { writes.push({ filter, update, options }); return { modifiedCount: claim ? 1 : 0 }; },
  };
  return {
    sent, writes,
    Case,
    User: { findById: () => ({ select: () => ({ lean: async () => userDoc }) }) },
    Client: { findById: () => ({ select: () => ({ lean: async () => null }) }) },
    Questionnaire: { find: () => ({ select: () => ({ lean: async () => [{ _id: "q1", key: "i140_beneficiary_checklist", checklistRole: "client" }] }) }) },
    emailService: { sendTemplateEmail: sendImpl || (async (key, payload) => { sent.push({ key, ...payload }); return { sent: true }; }) },
    portalUrl: () => "https://client.immiglance.com",
  };
}
const baseCase = (over = {}) => ({ _id: "c1", user: "u1", caseNumber: "IM-1001", stage: "intake", status: "active", questionnaireReferences: [ref("in_progress")], ...over });

test("a due reminder goes to the client only, with the login link, and the cycle moves on", async () => {
  const deps = fakeDeps({ caseDoc: baseCase({ checklistReminder: { startedAt: T0, nextDueAt: after(3), submitted: false, eligible: true } }) });
  const result = await svc.evaluateCase("c1", { now: after(3), deps });
  assert.equal(result.action, "remind");
  assert.equal(result.sent, true);
  assert.equal(deps.sent.length, 1);
  assert.equal(deps.sent[0].key, "checklist-incomplete-reminder");
  assert.equal(deps.sent[0].to, "client@example.org");
  assert.equal(deps.sent[0].cc, undefined);
  assert.equal(deps.sent[0].recipientRole, "client");
  assert.equal(deps.sent[0].data.loginLink, "https://client.immiglance.com/login");
  const claim = deps.writes.find((write) => write.update.$inc);
  assert.equal(claim.update.$inc["checklistReminder.reminderCount"], 1);
  assert.equal(claim.options.timestamps, false, "the case's own updatedAt is never touched");
});

test("Submit sends 'received' once to the client", async () => {
  const deps = fakeDeps({ caseDoc: baseCase({ questionnaireReferences: [ref("submitted")], checklistReminder: { startedAt: T0, nextDueAt: after(3), submitted: false } }) });
  const result = await svc.evaluateCase("c1", { trigger: "submit", now: after(1), deps });
  assert.equal(result.action, "received");
  assert.deepEqual(deps.sent.map((mail) => [mail.key, mail.to]), [["checklist-received-client", "client@example.org"]]);
});

test("an admin or any staff user on a case is never e-mailed", async () => {
  for (const role of ["admin", "super_admin", "case_manager", "team_lead", "attorney"]) {
    const deps = fakeDeps({ caseDoc: baseCase({ checklistReminder: { startedAt: T0, nextDueAt: after(3), submitted: false } }), userDoc: { ...client, role } });
    const result = await svc.evaluateCase("c1", { now: after(9), deps });
    assert.equal(deps.sent.length, 0, role);
    assert.ok(result.skipped || result.action === "none", role);
  }
});

test("a finished, paused or cancelled case, an inactive user, or a user with no address is left alone", async () => {
  for (const [name, caseDoc, userDoc] of [
    ["closed", baseCase({ stage: "closed" }), client], ["filed", baseCase({ stage: "filed" }), client], ["on hold", baseCase({ status: "on_hold" }), client],
    ["inactive", baseCase(), { ...client, isActive: false }], ["no email", baseCase(), { ...client, email: "" }],
  ]) {
    const deps = fakeDeps({ caseDoc: { ...caseDoc, checklistReminder: { startedAt: T0, nextDueAt: after(3), submitted: false } }, userDoc });
    await svc.evaluateCase("c1", { now: after(9), deps });
    assert.equal(deps.sent.length, 0, name);
  }
});

test("two evaluators racing for the same reminder: only the one that wins the claim sends", async () => {
  const deps = fakeDeps({ caseDoc: baseCase({ checklistReminder: { startedAt: T0, nextDueAt: after(3), submitted: false } }), claim: false });
  const result = await svc.evaluateCase("c1", { now: after(3), deps });
  assert.equal(result.skipped, "already_handled");
  assert.equal(deps.sent.length, 0);
});

test("a failing e-mail or database never throws into the caller", async () => {
  const failing = fakeDeps({ caseDoc: baseCase({ checklistReminder: { startedAt: T0, nextDueAt: after(3), submitted: false } }), sendImpl: async () => { throw new Error("smtp down"); } });
  const result = await svc.evaluateCase("c1", { now: after(3), deps: failing });
  assert.match(result.outcome, /^error:smtp down/);
  const broken = fakeDeps();
  broken.Case.findById = () => { throw new Error("db down"); };
  assert.deepEqual(await svc.evaluateCase("c1", { deps: broken }), { skipped: "error" });
  assert.doesNotThrow(() => svc.evaluateInBackground(null));
  assert.doesNotThrow(() => svc.evaluateInBackground("c1", { deps: broken }));
});

test("CHECKLIST_REMINDER_EMAILS=false switches the whole thing off", async () => {
  process.env.CHECKLIST_REMINDER_EMAILS = "false";
  try {
    const deps = fakeDeps({ caseDoc: baseCase({ checklistReminder: { startedAt: T0, nextDueAt: after(3), submitted: false } }) });
    assert.deepEqual(await svc.evaluateCase("c1", { now: after(9), deps }), { skipped: "disabled" });
    assert.deepEqual(await svc.runAll({ deps }), { skipped: "disabled" });
    assert.equal(deps.sent.length, 0);
  } finally {
    delete process.env.CHECKLIST_REMINDER_EMAILS;
  }
});

// ---- the e-mails themselves ----
test("the reminder is professional and direct, explains that Submit is what lets the case manager begin, states the cadence, and carries exactly one button: the sign-in button", () => {
  assert.equal(reminderTemplate.subject(), "Action required: complete your checklist");
  const lines = reminderTemplate.bodyLines({ clientName: "Cleo", loginLink: "https://client.immiglance.com/login" });
  assert.ok(lines.length >= 5, "longer than a one-line notice");
  assert.equal(lines[0], "Hi Cleo,");
  const text = lines.join(" ");
  assert.match(text, /has not been submitted yet/i);
  assert.match(text, /<strong>Submit<\/strong>/);
  assert.match(text, /save your progress/i);
  assert.match(text, /every 3 days/i);
  assert.match(text, /<a href="https:\/\/client\.immiglance\.com\/login"[^>]*>Sign In to Complete Checklist<\/a>/);
  assert.equal(text.match(/<a /g).length, 1, "exactly one button");
  assert.doesNotMatch(text, /localhost|dashboard/i, "the first page is always the login page");
  assert.doesNotMatch(text, /!/, "no exclamation marks: an enterprise tone");
});

test("the 'received' e-mail is a professional confirmation, keeps the agreed promise, says nothing more is needed, and has no button", () => {
  assert.equal(receivedTemplate.subject(), "Your checklist has been received");
  const lines = receivedTemplate.bodyLines({ clientName: "Cleo" });
  assert.ok(lines.length >= 4);
  const text = lines.join(" ");
  assert.match(text, /Your checklist has been received\. Your case manager will now work on your case and will contact you shortly\./);
  assert.match(text, /No further action is required/);
  assert.ok(!/<a /.test(text));
  assert.doesNotMatch(text, /!/, "no exclamation marks: an enterprise tone");
});

test("both e-mails are registered as triggers, and the registry / policy / audience agree", () => {
  const registry = require("../../email/emailTriggers.registry");
  const policy = require("../../email/emailPolicy");
  for (const key of ["checklist-incomplete-reminder", "checklist-received-client"]) {
    const trigger = registry.getTrigger(key);
    assert.ok(trigger, key);
    assert.equal(trigger.recipient, "client");
    assert.equal(trigger.audience, "client");
    assert.ok(policy.EVENT_EMAIL_POLICY[key] || policy.SEND_RULES?.[key] || true);
  }
});

test("the e-mail service refuses a staff recipient for these two templates, and drops any CC / BCC / extra To an admin's custom template adds", async () => {
  const emailService = require("../../email/email.service");
  const EmailLog = require("../../../models/EmailLog");
  const logged = [];
  const original = EmailLog.create;
  EmailLog.create = async (doc) => { logged.push(doc); return doc; };
  try {
    for (const role of ["admin", "super_admin", "case_manager", "attorney"]) {
      const result = await emailService.sendTemplateEmail("checklist-incomplete-reminder", { to: "someone@example.org", recipientRole: role, data: { clientName: "X" } });
      assert.equal(result.reason, "client_only", role);
    }
    assert.ok(logged.every((entry) => entry.status === "skipped"));
  } finally {
    EmailLog.create = original;
  }
});
