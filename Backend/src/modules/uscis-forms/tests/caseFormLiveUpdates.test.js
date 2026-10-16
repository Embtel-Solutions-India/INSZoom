// Live updates for an open form: who may watch, when the event is sent, and that it can never disturb the request. DB-free (loaders are injected).
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { authorizeJoin, buildEvent, kindOf, broadcastCaseFormChanges, EVENT, roomOf } = require("../caseFormLiveUpdates");

const ID1 = "64b000000000000000000001";
const ID2 = "64b000000000000000000002";
const deps = ({ allowed = true, permitted = true, form = { _id: ID2 }, caseData = { _id: ID1 } } = {}) => ({
  Case: { findById: () => ({ lean: async () => caseData }) },
  CaseForm: { findOne: (query) => ({ select: () => ({ lean: async () => (query.caseId === ID1 ? form : null) }) }) },
  caseService: { canAccessCase: () => allowed },
  hasPermission: () => permitted,
});
const user = { _id: "u1", firstName: "Raj", lastName: "Patel" };

test("joining needs forms:read, case access and a form that belongs to the case", async () => {
  assert.deepEqual(await authorizeJoin({ user, caseId: ID1, caseFormId: ID2 }, deps()), { ok: true });
  assert.equal((await authorizeJoin({ user, caseId: ID1, caseFormId: ID2 }, deps({ permitted: false }))).code, "FORM_ACCESS_DENIED");
  assert.equal((await authorizeJoin({ user, caseId: ID1, caseFormId: ID2 }, deps({ allowed: false }))).code, "FORM_ACCESS_DENIED");
  assert.equal((await authorizeJoin({ user, caseId: ID1, caseFormId: ID2 }, deps({ caseData: null }))).code, "FORM_ACCESS_DENIED");
  assert.equal((await authorizeJoin({ user, caseId: ID1, caseFormId: ID2 }, deps({ form: null }))).code, "FORM_NOT_FOUND");
  assert.equal((await authorizeJoin({ user, caseId: "nope", caseFormId: ID2 }, deps())).code, "INVALID_REQUEST");
  assert.equal((await authorizeJoin({ user: null, caseId: ID1, caseFormId: ID2 }, deps())).code, "INVALID_REQUEST");
});

test("the event says who changed what, and carries no form data", () => {
  const event = buildEvent({ params: { caseId: ID1, formId: ID2 }, user, originalUrl: `/api/uscis-forms/case/${ID1}/${ID2}/workspace/field`, body: { fieldName: "part1.name", value: "SECRET VALUE", ssn: "123" } });
  assert.equal(event.actorName, "Raj Patel");
  assert.equal(event.kind, "field");
  assert.equal(event.fieldName, "part1.name");
  assert.doesNotMatch(JSON.stringify(event), /SECRET VALUE|123/);
  assert.equal(kindOf("/x/workspace/decision?a=1"), "decision");
  assert.equal(roomOf(ID2), `caseForm:${ID2}`);
});

const run = (method, statusCode, emit, extra = {}) => {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  const req = { method, params: { caseId: ID1, formId: ID2 }, user, originalUrl: `/case/${ID1}/${ID2}/workspace/field`, body: {}, ...extra };
  let nexted = 0;
  broadcastCaseFormChanges({ emit })(req, res, () => { nexted += 1; });
  return { res, nexted: () => nexted };
};

test("a successful change is broadcast to the form's room AFTER the response, never before", () => {
  const sent = [];
  const { res, nexted } = run("PATCH", 200, (room, event, payload) => sent.push({ room, event, payload }));
  assert.equal(nexted(), 1);
  assert.equal(sent.length, 0); // the request has not finished yet
  res.emit("finish");
  assert.equal(sent.length, 1);
  assert.deepEqual([sent[0].room, sent[0].event], [ID2, EVENT]);
});

test("nothing is sent for reads, failed requests or an invalid form id", () => {
  const sent = [];
  const emit = (...args) => sent.push(args);
  for (const [method, status] of [["GET", 200], ["PATCH", 403], ["PATCH", 409], ["POST", 500], ["PUT", 304]]) {
    const { res, nexted } = run(method, status, emit);
    res.emit("finish");
    assert.equal(nexted(), 1);
  }
  const bad = run("PATCH", 200, emit, { params: { caseId: ID1, formId: "not-an-id" } });
  bad.res.emit("finish");
  assert.equal(bad.nexted(), 1);
  assert.equal(sent.length, 0);
});

test("a failing broadcaster can never break or delay the request", () => {
  const { res, nexted } = run("PATCH", 200, () => { throw new Error("socket exploded"); });
  assert.equal(nexted(), 1);
  assert.doesNotThrow(() => res.emit("finish"));
});

test("with no socket server running (scripts, tests, a worker) the default broadcaster is a harmless no-op", () => {
  const res = new EventEmitter();
  res.statusCode = 200;
  broadcastCaseFormChanges()({ method: "PATCH", params: { caseId: ID1, formId: ID2 }, user, originalUrl: "/x", body: {} }, res, () => {});
  assert.doesNotThrow(() => res.emit("finish"));
});
