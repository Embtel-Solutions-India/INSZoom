// Petition AI Review - Phase 4 acceptance tests (database-free: the real router in a local HTTP server, an in-memory store on the real schemas).
// Proves: sign-in required; only staff roles; a person without access to the case gets 403 and an unknown scan 404 (never another case's data);
// the case list returns counts only; findings are paged and filtered; re-scan / retry / cancel behave (and kick the worker); with the feature off
// the reads answer and the actions say "switched off"; the notifier throttles progress, notifies the right people, and never throws.
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Types } = require("mongoose");
const PetitionAiScan = require("../../../models/PetitionAiScan");
const PetitionAiFinding = require("../../../models/PetitionAiFinding");
const authorizeRoles = require("../../../middleware/authorizeRoles");
const { createFakeModel, oneOpenScanPerPetition } = require("./fixtures/fakeModel");
const { createScanService } = require("../scanService");
const { createReviewApi, STAFF_ROLES } = require("../reviewApi.service");
const { createRouter } = require("../petitionAiReview.routes");
const { createNotifier } = require("../notifier");
const { SCAN_STATUS } = require("../constants");

const quiet = { info() {}, warn() {}, error() {} };
const oid = () => new Types.ObjectId();

function world({ enabled = true } = {}) {
  const Scan = createFakeModel(PetitionAiScan, { unique: oneOpenScanPerPetition });
  const Finding = createFakeModel(PetitionAiFinding);
  const scanService = createScanService({ Scan, Finding });
  const kicks = { count: 0 };
  const caseA = { _id: oid(), caseNumber: "B442-B" };
  const caseB = { _id: oid(), caseNumber: "B999" };
  const cases = new Map([[String(caseA._id), caseA], [String(caseB._id), caseB]]);
  const manager = { _id: oid(), role: "case_manager", cases: [String(caseA._id)] };
  const outsider = { _id: oid(), role: "case_manager", cases: [String(caseB._id)] };
  const client = { _id: oid(), role: "client", cases: [String(caseA._id)] };
  const petitionA = { _id: oid(), caseId: caseA._id, documentType: "petition_manual_upload", originalName: "petition-A.pdf", createdAt: new Date() };
  const passport = { _id: oid(), caseId: caseA._id, documentType: "passport", originalName: "passport.pdf", createdAt: new Date() };
  const petitionB = { _id: oid(), caseId: caseB._id, documentType: "petition_manual_upload", originalName: "petition-B.pdf", createdAt: new Date() };
  const deleted = { _id: oid(), caseId: caseA._id, documentType: "petition_manual_upload", originalName: "old.pdf", deletedAt: new Date(), createdAt: new Date(0) };
  const docs = [petitionA, passport, petitionB, deleted];
  const lean = (value) => ({ select() { return this; }, sort() { return this; }, lean: async () => value });
  const Document = {
    find: (filter) => lean(docs.filter((d) => String(d.caseId) === String(filter.caseId) && d.documentType === filter.documentType && !d.deletedAt)),
    findById: (id) => lean(docs.find((d) => String(d._id) === String(id)) || null),
  };
  const api = createReviewApi({
    Scan, Finding, Document,
    getCase: async (id) => cases.get(String(id)) || null,
    canAccessCase: (user, caseData) => (user.cases || []).includes(String(caseData._id)),
    handle: () => (enabled ? { scanService, worker: { kick: () => { kicks.count += 1; } } } : null),
  });
  const users = new Map([["manager", manager], ["outsider", outsider], ["client", client]]);
  const guard = (req, res, next) => { const user = users.get(req.headers["x-test-user"]); if (!user) return res.status(401).json({ success: false, message: "Sign in" }); req.user = user; return next(); };
  const app = express();
  app.use(express.json());
  app.use("/api/petition-ai-review", createRouter({ api, guard: [guard], roles: authorizeRoles(...STAFF_ROLES) }));
  return { Scan, Finding, scanService, api, app, kicks, caseA, caseB, petitionA, petitionB, passport, deleted };
}

async function serve(app, fn) {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/petition-ai-review`;
  const call = async (method, path, user) => {
    const response = await fetch(base + path, { method, headers: user ? { "x-test-user": user } : {} });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  try { await fn(call); } finally { await new Promise((resolve) => server.close(resolve)); }
}

async function scanWithFindings(w) {
  const { scan } = await w.scanService.enqueue({ caseId: w.caseA._id, documentId: w.petitionA._id, documentName: "petition-A.pdf" });
  const claim = await w.scanService.claimNext();
  const findings = [];
  for (let page = 1; page <= 12; page += 1) findings.push({ page, severity: page % 3 === 0 ? "error" : "warning", category: page % 2 ? "typo" : "wrong_name", excerpt: `p${page}`, found: "x" });
  await w.scanService.recordProgress(claim.scan, claim.lease, { from: 1, to: 12, findings, nextPage: 13, pagesDone: 12, diagnostics: Array.from({ length: 60 }, (_, i) => ({ from: i, to: i, outcome: "OK", note: "n" })) });
  await w.scanService.complete(scan._id, claim.lease, { status: SCAN_STATUS.COMPLETED, counts: { error: 4, warning: 8, info: 0 }, summary: { text: "12 issues", byPage: [{ page: 3, count: 1, worst: "error" }], byCategory: { typo: 6, wrong_name: 6 } }, gaps: [] });
  return scan;
}

test("sign-in required; client / attorney roles refused; a person without access to the case gets 403, an unknown scan 404", async () => {
  const w = world();
  const scan = await scanWithFindings(w);
  await serve(w.app, async (call) => {
    assert.equal((await call("GET", `/cases/${w.caseA._id}`)).status, 401);
    assert.equal((await call("GET", `/cases/${w.caseA._id}`, "client")).status, 403, "clients never see AI review");
    assert.equal((await call("GET", `/cases/${w.caseA._id}`, "outsider")).status, 403);
    assert.equal((await call("GET", `/scans/${scan._id}`, "outsider")).status, 403, "another case's scan is never shown");
    assert.equal((await call("GET", `/scans/${scan._id}/findings`, "outsider")).status, 403);
    assert.equal((await call("POST", `/scans/${scan._id}/cancel`, "outsider")).status, 403);
    assert.equal((await call("GET", `/scans/${oid()}`, "manager")).status, 404);
    assert.equal((await call("GET", "/scans/not-an-id", "manager")).status, 404);
    assert.equal((await call("GET", "/cases/not-an-id", "manager")).status, 404);
  });
});

test("case list: each petition with its latest scan, counts only (no findings, no diagnostics); deleted petitions and other documents left out", async () => {
  const w = world();
  await scanWithFindings(w);
  await serve(w.app, async (call) => {
    const { status, body } = await call("GET", `/cases/${w.caseA._id}`, "manager");
    assert.equal(status, 200);
    assert.equal(body.data.enabled, true);
    assert.deepEqual(body.data.petitions.map((p) => p.name), ["petition-A.pdf"]);
    const scan = body.data.petitions[0].scan;
    assert.equal(scan.status, SCAN_STATUS.COMPLETED);
    assert.deepEqual(scan.counts, { error: 4, warning: 8, info: 0 });
    for (const heavy of ["summary", "diagnostics", "findings", "lease", "gaps"]) assert.equal(scan[heavy], undefined, heavy);
  });
});

test("scan detail: summary, page -> issues, newest 50 diagnostics, never the lease", async () => {
  const w = world();
  const scan = await scanWithFindings(w);
  await serve(w.app, async (call) => {
    const { body } = await call("GET", `/scans/${scan._id}`, "manager");
    assert.equal(body.data.summary.text, "12 issues");
    assert.deepEqual(body.data.summary.byCategory, { typo: 6, wrong_name: 6 });
    assert.equal(body.data.diagnostics.length, 50);
    assert.equal(body.data.lease, undefined);
  });
});

test("findings are paged (default 50, at most 200) and filtered by severity, category and page range", async () => {
  const w = world();
  const scan = await scanWithFindings(w);
  await serve(w.app, async (call) => {
    let { body } = await call("GET", `/scans/${scan._id}/findings?limit=5&page=2`, "manager");
    assert.deepEqual(body.data.findings.map((f) => f.page), [6, 7, 8, 9, 10]);
    assert.deepEqual(body.data.pagination, { page: 2, limit: 5, total: 12, pages: 3 });
    ({ body } = await call("GET", `/scans/${scan._id}/findings?severity=error`, "manager"));
    assert.deepEqual(body.data.findings.map((f) => f.page), [3, 6, 9, 12]);
    ({ body } = await call("GET", `/scans/${scan._id}/findings?category=typo&fromPage=3&toPage=7`, "manager"));
    assert.deepEqual(body.data.findings.map((f) => f.page), [3, 5, 7]);
    ({ body } = await call("GET", `/scans/${scan._id}/findings?limit=9999&severity=nonsense`, "manager"));
    assert.equal(body.data.pagination.limit, 200);
    assert.equal(body.data.pagination.total, 12, "an unknown filter value is ignored, not an error");
  });
});

test("re-scan starts one scan and wakes the worker; a second re-scan returns the running one; only this case's petitions", async () => {
  const w = world();
  await serve(w.app, async (call) => {
    const first = await call("POST", `/cases/${w.caseA._id}/documents/${w.petitionA._id}/rescan`, "manager");
    assert.equal(first.status, 201);
    assert.equal(first.body.data.created, true);
    assert.equal(first.body.data.scan.trigger, "manual");
    assert.equal(w.kicks.count, 1);
    const again = await call("POST", `/cases/${w.caseA._id}/documents/${w.petitionA._id}/rescan`, "manager");
    assert.equal(again.body.data.created, false);
    assert.equal(again.body.data.scan.id, first.body.data.scan.id);
    assert.equal(w.kicks.count, 1, "no extra wake-up for the same scan");
    assert.equal((await call("POST", `/cases/${w.caseA._id}/documents/${w.passport._id}/rescan`, "manager")).status, 404, "not a petition");
    assert.equal((await call("POST", `/cases/${w.caseA._id}/documents/${w.petitionB._id}/rescan`, "manager")).status, 404, "another case's petition");
    assert.equal((await call("POST", `/cases/${w.caseA._id}/documents/${w.deleted._id}/rescan`, "manager")).status, 404, "a deleted petition");
  });
});

test("cancel a running scan, cancel twice -> 409, retry reopens it, retry while another scan of that petition is open -> 409", async () => {
  const w = world();
  const { scan } = await w.scanService.enqueue({ caseId: w.caseA._id, documentId: w.petitionA._id });
  await serve(w.app, async (call) => {
    const cancelled = await call("POST", `/scans/${scan._id}/cancel`, "manager");
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body.data.scan.status, SCAN_STATUS.CANCELLED);
    assert.equal((await call("POST", `/scans/${scan._id}/cancel`, "manager")).status, 409);
    const reopened = await call("POST", `/scans/${scan._id}/retry`, "manager");
    assert.equal(reopened.body.data.reopened, true);
    assert.equal(reopened.body.data.scan.status, SCAN_STATUS.QUEUED);
    await call("POST", `/scans/${scan._id}/cancel`, "manager");
    await w.scanService.rescan({ caseId: w.caseA._id, documentId: w.petitionA._id });
    assert.equal((await call("POST", `/scans/${scan._id}/retry`, "manager")).status, 409);
  });
});

test("feature switched off: the reads still answer (enabled: false), the actions answer 404 'switched off'", async () => {
  const w = world({ enabled: false });
  await serve(w.app, async (call) => {
    const list = await call("GET", `/cases/${w.caseA._id}`, "manager");
    assert.equal(list.status, 200);
    assert.equal(list.body.data.enabled, false);
    const rescan = await call("POST", `/cases/${w.caseA._id}/documents/${w.petitionA._id}/rescan`, "manager");
    assert.equal(rescan.status, 404);
    assert.match(rescan.body.message, /switched off/);
  });
});

test("notifier: live progress at most once per scan every 2 s, to the case team only", async () => {
  const clock = { t: 0 };
  const sent = [];
  const scan = { _id: oid(), caseId: oid(), documentId: oid() };
  const notifier = createNotifier({ logger: quiet, now: () => clock.t, getCase: async () => ({ _id: scan.caseId }), teamIds: () => ["cm1", "tl1"], gateway: () => ({ emitToUser: (id, event, payload) => sent.push({ id, event, payload }) }), Scan: {}, notificationService: () => ({}) });
  assert.equal(await notifier.progress(scan, { pagesDone: 4, lastPage: 12 }), true);
  clock.t = 1500;
  assert.equal(await notifier.progress(scan, { pagesDone: 8, lastPage: 12 }), false, "throttled");
  clock.t = 2100;
  assert.equal(await notifier.progress(scan, { pagesDone: 12, lastPage: 12 }), true);
  assert.deepEqual([...new Set(sent.map((s) => s.id))], ["cm1", "tl1"]);
  assert.ok(sent.every((s) => s.event === "petition:ai_review" && s.payload.status === SCAN_STATUS.SCANNING));
});

test("notifier: a finished scan notifies the team and the person who started it; the bell only for end states; failures never throw", async () => {
  const requester = oid();
  const store = new Map();
  const mk = (status, extra = {}) => { const s = { _id: oid(), caseId: oid(), documentId: oid(), documentName: "petition.pdf", status, counts: { error: 2, warning: 1, info: 0 }, requestedBy: requester, ...extra }; store.set(String(s._id), s); return s; };
  const Scan = { findById: (id) => ({ select: () => ({ lean: async () => store.get(String(id)) || null }) }) };
  const sent = [];
  const bells = [];
  const notifier = createNotifier({ logger: quiet, Scan, getCase: async () => ({}), teamIds: () => ["cm1"], gateway: () => ({ emitToUser: (id, event) => sent.push({ id, event }) }), notificationService: () => ({ createNotification: async (payload) => bells.push(payload) }) });
  const done = mk(SCAN_STATUS.COMPLETED);
  assert.equal(await notifier.finished(done._id, { state: SCAN_STATUS.COMPLETED }), true);
  assert.deepEqual(sent.map((s) => s.id).sort(), ["cm1", String(requester)].sort());
  assert.equal(bells.length, 1);
  assert.equal(String(bells[0].userId), String(requester));
  assert.match(bells[0].message, /3 issues found in petition\.pdf \(2 to fix\)/);
  assert.equal(bells[0].type, "general");
  const paused = mk(SCAN_STATUS.QUEUED);
  await notifier.finished(paused._id, { state: "paused" });
  assert.equal(bells.length, 1, "no bell for a pause - the scan resumes by itself");
  for (const status of [SCAN_STATUS.COMPLETED_WITH_GAPS, SCAN_STATUS.FAILED, SCAN_STATUS.NOT_CONFIGURED]) await notifier.finished(mk(status, { error: { message: "billing" } })._id, { state: status });
  assert.equal(bells.length, 4);
  const broken = createNotifier({ logger: quiet, Scan, getCase: async () => { throw new Error("db down"); }, gateway: () => { throw new Error("socket down"); }, notificationService: () => ({ createNotification: async () => { throw new Error("mail down"); } }) });
  assert.equal(await broken.finished(done._id, {}), true, "every failure is swallowed and logged");
  assert.equal(await broken.progress(done, {}), true);
  assert.equal(await createNotifier({ logger: quiet, Scan: { findById: () => { throw new Error("x"); } } }).finished(oid(), {}), false);
});
