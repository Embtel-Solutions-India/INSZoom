// DB-free: proves the real save paths raise the live event, and that a failure in the live part can never fail a save.
const assert = require("node:assert/strict");
const test = require("node:test");

const AuditLog = require("../../../models/AuditLog");
const Case = require("../../../models/Case");
const gateway = require("../realtime.gateway");
const live = require("../caseLiveUpdates");
const documentService = require("../../documents/document.service");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const questionnaireController = require("../../questionnaires/questionnaire.controller");

const emits = [];
const saved = { audit: AuditLog.create, findById: Case.findById, emitToUser: gateway.emitToUser, emitToRole: gateway.emitToRole, saveAnswers: questionnaireService.saveAnswers, saveFileAnswer: questionnaireService.saveFileAnswer };

test.before(() => {
  AuditLog.create = async () => ({});
  Case.findById = () => ({ select: () => ({ lean: async () => ({ caseNumber: "B9", user: "client-user", assignedCaseManager: "cm-user" }) }) });
  gateway.emitToUser = (userId, event, payload) => { emits.push({ userId: String(userId), event, payload }); return true; };
  gateway.emitToRole = () => true;
});
test.after(() => {
  AuditLog.create = saved.audit; Case.findById = saved.findById; gateway.emitToUser = saved.emitToUser; gateway.emitToRole = saved.emitToRole;
  questionnaireService.saveAnswers = saved.saveAnswers; questionnaireService.saveFileAnswer = saved.saveFileAnswer;
});
test.beforeEach(() => { emits.length = 0; });

const mockRes = () => { const res = { body: null }; res.json = (payload) => { res.body = payload; return res; }; res.status = () => res; return res; };

test("a document upload / review / delete raises the live event for the documents section (populated caseId works)", async () => {
  await documentService.writeAuditLog("upload", { _id: "d1", caseId: { _id: "case1", caseNumber: "B9" } }, { _id: "client-user" }, {}, {});
  await live.flushPending();
  assert.deepEqual(emits.map((e) => e.userId).sort(), ["client-user", "cm-user"]);
  assert.deepEqual(emits[0].payload.scope, ["documents"]);
  assert.equal(emits[0].payload.caseId, "case1");
  assert.equal(emits[0].payload.reason, "document_upload");
});

test("saving an answer responds first, then raises the live event for answers + checklist", async () => {
  questionnaireService.saveAnswers = async () => ({ answers: [{ caseId: "case1", questionKey: "q" }], responseId: "r1" });
  const res = mockRes();
  let nextError = null;
  await questionnaireController.saveAnswer({ params: { id: "qn" }, body: { caseId: "case1" }, query: {}, user: { _id: "client-user", role: "client" } }, res, (e) => { nextError = e; });
  assert.equal(nextError, null);
  assert.equal(res.body.success, true);
  await live.flushPending();
  assert.ok(emits.length > 0);
  assert.deepEqual([...emits[0].payload.scope].sort(), ["answers", "checklist"]);
});

test("a file answer also refreshes the documents section", async () => {
  questionnaireService.saveFileAnswer = async () => ({ answers: [{ caseId: "case1" }] });
  const res = mockRes();
  await questionnaireController.saveFileAnswer({ params: { id: "qn" }, body: { caseId: "case1" }, query: {}, files: [{}], user: { _id: "u", role: "client" } }, res, () => {});
  await live.flushPending();
  assert.deepEqual([...emits[0].payload.scope].sort(), ["answers", "checklist", "documents"]);
});

test("a save whose live update would blow up still succeeds and returns normally", async () => {
  questionnaireService.saveAnswers = async () => ({ answers: [{ caseId: "case1" }] });
  gateway.emitToUser = () => { throw new Error("socket exploded"); };
  const res = mockRes();
  let nextError = null;
  await questionnaireController.saveAnswer({ params: { id: "qn" }, body: { caseId: "case1" }, query: {}, user: { _id: "u", role: "client" } }, res, (e) => { nextError = e; });
  await assert.doesNotReject(live.flushPending());
  assert.equal(nextError, null);
  assert.equal(res.body.success, true);
  gateway.emitToUser = (userId, event, payload) => { emits.push({ userId: String(userId), event, payload }); return true; };
});

test("a failed save raises no live event", async () => {
  questionnaireService.saveAnswers = async () => { throw new Error("validation failed"); };
  let nextError = null;
  await questionnaireController.saveAnswer({ params: { id: "qn" }, body: { caseId: "case1" }, query: {}, user: { _id: "u", role: "client" } }, mockRes(), (e) => { nextError = e; });
  await live.flushPending();
  assert.match(nextError.message, /validation failed/);
  assert.equal(emits.length, 0);
});
