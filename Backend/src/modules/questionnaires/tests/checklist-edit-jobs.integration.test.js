// Checklist edits done in the background: accepted at once, run by the server, retried until they succeed, kept in order, safe to run twice.
// Runs on the local test database (never the real one).
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");

const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const Case = require("../../../models/Case");
const User = require("../../../models/User");
const Question = require("../../../models/Question");
const Questionnaire = require("../../../models/Questionnaire");
const EmployerProfile = require("../../../models/EmployerProfile");
const ChecklistEditJob = require("../../../models/ChecklistEditJob");
const questionnaireService = require("../questionnaire.service");
const checklistService = require("../case-checklist.service");
const jobs = require("../checklist-edit-jobs.service");

const ADMIN_ID = new mongoose.Types.ObjectId();

async function withChecklist(t, run) {
  t.after(disconnectTestDB);
  await connectTestDB();
  await questionnaireService.ensureDefaultVisaTemplates(null, null, {}).catch(() => {});
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const admin = await User.create({ email: `job-admin-${stamp}@example.com`, name: "Job Admin", role: "admin", isActive: true });
  const employer = await User.create({ email: `job-emp-${stamp}@example.com`, name: "Job Employer", role: "client", isActive: true, caseRole: "principal" });
  const number = `TESTJOB${stamp}`;
  const [principal] = await Case.create([{
    caseId: number, caseNumber: number, clientPortalId: number, clientName: "Job Employer", clientEmail: employer.email,
    visaType: "H-1B", visaCategory: "H-1B", petitionType: "H-1B", petitionSubType: "New H-1B", caseType: "immigration", status: "active",
    user: employer._id, caseStructure: "employer_employee", caseRole: "principal", childCaseCount: 0, dataEntryMode: "fill_self",
    checklistApproval: { required: false },
  }]);
  const [profile] = await EmployerProfile.create([{ principalCaseId: principal._id }]);
  principal.employerProfileId = profile._id;
  await principal.save();
  const realEdit = checklistService.editChecklist;
  try {
    const list = await questionnaireService.listCaseChecklists(principal._id, admin.toObject());
    const entry = list.checklists.find((c) => c.targetRole === "employer" && !c.staffRequest);
    assert.ok(entry, "the case lists a petitioner checklist");
    const questions = await Question.find({ questionnaire: entry.questionnaireId, active: { $ne: false } }).sort({ order: 1 }).limit(3).lean();
    assert.ok(questions.length >= 3, "the checklist has questions");
    await run({ admin, principal, checklistId: entry.checklistId, questions });
  } finally {
    checklistService.editChecklist = realEdit;
    await ChecklistEditJob.deleteMany({ caseId: principal._id });
    const copies = await Questionnaire.find({ key: { $regex: `__case_${principal._id}$` } }).select("_id").lean();
    await Question.deleteMany({ questionnaire: { $in: copies.map((c) => c._id) } });
    await Questionnaire.deleteMany({ _id: { $in: copies.map((c) => c._id) } });
    await Case.deleteMany({ _id: principal._id });
    await EmployerProfile.deleteMany({ principalCaseId: principal._id });
    await User.deleteMany({ _id: { $in: [admin._id, employer._id] } });
  }
}

const copyQuestion = async (principalId, key) => {
  const copy = await Questionnaire.findOne({ key: { $regex: `__case_${principalId}$` } }).lean();
  return copy ? Question.findOne({ questionnaire: copy._id, key }).lean() : null;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 150)); // lets the kick started by enqueueEdit finish

test("a remove is accepted at once and the server carries it out", async (t) => {
  await withChecklist(t, async ({ admin, principal, checklistId, questions }) => {
    const started = Date.now();
    const job = await jobs.enqueueEdit(principal._id, { op: "remove", checklistId, questionKey: questions[0].key }, admin.toObject());
    assert.equal(job.status, "pending");
    assert.ok(Date.now() - started < 2000, "accepted without waiting for the work");
    // the work happens afterwards, by itself
    for (let i = 0; i < 40 && (await ChecklistEditJob.findById(job._id).lean()).status !== "done"; i += 1) await new Promise((r) => setTimeout(r, 250));
    const done = await ChecklistEditJob.findById(job._id).lean();
    assert.equal(done.status, "done", done.lastError);
    assert.equal((await copyQuestion(principal._id, questions[0].key)).active, false, "the question is retired on this case's copy");
  });
});

test("a failing attempt is retried by the server, with a delay, until it succeeds", async (t) => {
  await withChecklist(t, async ({ admin, principal, checklistId, questions }) => {
    let calls = 0;
    const real = checklistService.editChecklist;
    checklistService.editChecklist = async (...args) => { calls += 1; if (calls <= 2) throw new Error("database timed out"); return real(...args); };
    const job = await jobs.enqueueEdit(principal._id, { op: "remove", checklistId, questionKey: questions[1].key }, admin.toObject());
    await settle();
    let state = await ChecklistEditJob.findById(job._id).lean();
    assert.equal(state.status, "pending");
    assert.equal(state.attempts, 1);
    assert.match(state.lastError, /timed out/);
    assert.ok(state.nextAttemptAt > new Date(), "the next try waits (backoff)");
    assert.equal(await jobs.processJob(job._id), null, "not due yet: nothing happens early");

    await ChecklistEditJob.updateOne({ _id: job._id }, { $set: { nextAttemptAt: new Date() } }); // the delay passes
    await jobs.processJob(job._id);
    state = await ChecklistEditJob.findById(job._id).lean();
    assert.equal(state.status, "pending");
    assert.equal(state.attempts, 2);

    await ChecklistEditJob.updateOne({ _id: job._id }, { $set: { nextAttemptAt: new Date() } });
    await jobs.processJob(job._id);
    state = await ChecklistEditJob.findById(job._id).lean();
    assert.equal(state.status, "done");
    assert.equal(state.attempts, 3);
    assert.equal(calls, 3);
    assert.equal((await copyQuestion(principal._id, questions[1].key)).active, false);
  });
});

test("an edit that can never succeed fails once instead of being retried forever, and does not block the edits behind it", async (t) => {
  await withChecklist(t, async ({ admin, principal, checklistId, questions }) => {
    const bad = await jobs.enqueueEdit(principal._id, { op: "remove", checklistId, questionKey: "no_such_question" }, admin.toObject());
    const good = await jobs.enqueueEdit(principal._id, { op: "remove", checklistId, questionKey: questions[2].key }, admin.toObject());
    for (let i = 0; i < 40 && (await ChecklistEditJob.findById(good._id).lean()).status !== "done"; i += 1) await new Promise((r) => setTimeout(r, 250));
    const badState = await ChecklistEditJob.findById(bad._id).lean();
    assert.equal(badState.status, "failed");
    assert.equal(badState.attempts, 1, "no pointless retries");
    assert.equal((await ChecklistEditJob.findById(good._id).lean()).status, "done", "the edit queued behind it still ran");
    assert.equal((await copyQuestion(principal._id, questions[2].key)).active, false);
  });
});

test("edits to the same checklist run in the order they were made", async (t) => {
  await withChecklist(t, async ({ admin, principal, checklistId, questions }) => {
    const order = [];
    const real = checklistService.editChecklist;
    checklistService.editChecklist = async (caseId, body, ...rest) => { order.push(`${body.op}:${body.questionKey}`); return real(caseId, body, ...rest); };
    // written down directly (no kick), the way a burst of clicks lands before the worker reaches them
    const first = await ChecklistEditJob.create({ caseId: principal._id, checklistId, op: "update", questionKey: questions[0].key, patch: { label: "Renamed once" }, requestedBy: admin._id });
    const second = await ChecklistEditJob.create({ caseId: principal._id, checklistId, op: "remove", questionKey: questions[0].key, requestedBy: admin._id });
    assert.equal(await jobs.processJob(second._id), null, "the second waits for the first");
    assert.equal((await ChecklistEditJob.findById(second._id).lean()).attempts, 0);
    assert.ok(await jobs.processJob(first._id));
    assert.ok(await jobs.processJob(second._id));
    assert.deepEqual(order, [`update:${questions[0].key}`, `remove:${questions[0].key}`]);
    const q = await copyQuestion(principal._id, questions[0].key);
    assert.equal(q.label, "Renamed once");
    assert.equal(q.active, false);
  });
});

test("two workers claiming the same job run it once; a worker that died mid-job is recovered", async (t) => {
  await withChecklist(t, async ({ admin, principal, checklistId, questions }) => {
    let calls = 0;
    const real = checklistService.editChecklist;
    checklistService.editChecklist = async (...args) => { calls += 1; await new Promise((r) => setTimeout(r, 100)); return real(...args); };
    const job = await ChecklistEditJob.create({ caseId: principal._id, checklistId, op: "remove", questionKey: questions[0].key, requestedBy: admin._id });
    await Promise.all([jobs.processJob(job._id), jobs.processJob(job._id)]);
    assert.equal(calls, 1, "claimed by exactly one");
    assert.equal((await ChecklistEditJob.findById(job._id).lean()).status, "done");

    // a job left "processing" by a crashed server, its lease long expired, is picked up by the worker tick
    const orphan = await ChecklistEditJob.create({ caseId: principal._id, checklistId, op: "remove", questionKey: questions[1].key, requestedBy: admin._id, status: "processing", attempts: 1, lockedUntil: new Date(Date.now() - 60000) });
    await jobs.processDueJobs();
    assert.equal((await ChecklistEditJob.findById(orphan._id).lean()).status, "done");
    assert.equal((await copyQuestion(principal._id, questions[1].key)).active, false);
  });
});

test("a request that could never work is refused immediately instead of being queued", async (t) => {
  await withChecklist(t, async ({ admin, principal, checklistId, questions }) => {
    await assert.rejects(jobs.enqueueEdit(principal._id, { op: "add", checklistId, patch: { label: "x" } }, admin.toObject()), (e) => e.status === 400);
    await assert.rejects(jobs.enqueueEdit(principal._id, { op: "remove", checklistId }, admin.toObject()), (e) => e.status === 400);
    await assert.rejects(jobs.enqueueEdit(new mongoose.Types.ObjectId(), { op: "remove", checklistId, questionKey: questions[0].key }, admin.toObject()), (e) => e.status === 404);
    const stranger = { _id: new mongoose.Types.ObjectId(), role: "attorney" }; // an attorney with no access to this case
    await assert.rejects(jobs.enqueueEdit(principal._id, { op: "remove", checklistId, questionKey: questions[0].key }, stranger), (e) => e.status === 403);
    assert.equal(await ChecklistEditJob.countDocuments({ caseId: principal._id }), 0, "nothing was queued");
    assert.equal(jobs.supportsBackground("add"), false);
  });
});

test("a repeated edit is harmless: removing an already removed question succeeds", async (t) => {
  await withChecklist(t, async ({ admin, principal, checklistId, questions }) => {
    await checklistService.editChecklist(principal._id, { op: "remove", checklistId, questionKey: questions[0].key }, admin.toObject(), { headers: {}, ip: "test" });
    const job = await ChecklistEditJob.create({ caseId: principal._id, checklistId, op: "remove", questionKey: questions[0].key, requestedBy: admin._id });
    assert.ok(await jobs.processJob(job._id));
    assert.equal((await ChecklistEditJob.findById(job._id).lean()).status, "done");
    assert.equal(ADMIN_ID instanceof mongoose.Types.ObjectId, true);
  });
});
