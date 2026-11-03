// Case notes for the life of the case (2026-11-04), DB-free: the real controller, the real Case schema and the real access rule; only the
// database read / save, the audit log, the socket and the live-update broadcast are stubbed.
// Proves: any internal staff member adds a note; only its writer edits it (earlier wording kept); any internal staff member deletes one (kept
// on the record, hidden); a missing / already deleted note is 404; every change tells the internal screens (live sync).
const test = require("node:test");
const assert = require("node:assert/strict");
const { Types } = require("mongoose");
const Case = require("../../../models/Case");
const caseService = require("../case.service");
const realtimeGateway = require("../../realtime/realtime.gateway");
const caseLiveUpdates = require("../../realtime/caseLiveUpdates");
const ctrl = require("../case.controller");

const oid = () => new Types.ObjectId();
const writer = { _id: oid(), role: "case_manager", name: "Vasu" };
const otherCm = { _id: oid(), role: "case_manager", name: "Other" };
const admin = { _id: oid(), role: "admin", name: "Admin" };

function setup(t) {
  const caseDoc = Case.hydrate({ _id: oid(), caseNumber: "B442", user: oid(), assignedCaseManager: oid(), internalNotes: [], auditHistory: [], timeline: [] });
  caseDoc.save = async function save() { return this; };
  t.mock.method(Case, "findById", async () => caseDoc);
  t.mock.method(caseService, "writeAuditLog", async () => null);
  for (const name of ["emitToRole", "emitToUser"]) if (typeof realtimeGateway[name] === "function") t.mock.method(realtimeGateway, name, () => true);
  const live = t.mock.method(caseLiveUpdates, "notifyCaseDataChanged", () => true);
  return { caseDoc, live };
}
function call(handler, { user, params = {}, body = {} }) {
  return new Promise((resolve, reject) => {
    const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) { resolve({ status: this.statusCode, body: payload }); } };
    handler({ user, params, body, headers: {} }, res, reject);
  });
}

test("any internal staff member adds a note at any time, and the internal screens are told (live sync)", async (t) => {
  const { caseDoc, live } = setup(t);
  for (const user of [writer, otherCm, admin]) {
    const out = await call(ctrl.addInternalNote, { user, params: { id: String(caseDoc._id) }, body: { note: `note by ${user.name}` } });
    assert.equal(out.status, 200, user.role);
  }
  assert.equal(caseDoc.internalNotes.length, 3);
  assert.equal(live.mock.callCount(), 3);
  assert.equal(live.mock.calls[0].arguments[1], "notes");
});

test("only the writer edits a note; the earlier wording is kept in its history; the screens are told", async (t) => {
  const { caseDoc, live } = setup(t);
  caseDoc.internalNotes.push({ author: writer._id, note: "First wording" });
  const noteId = String(caseDoc.internalNotes[0]._id);
  const refused = await call(ctrl.updateInternalNote, { user: otherCm, params: { id: String(caseDoc._id), noteId }, body: { note: "hijack" } });
  assert.equal(refused.status, 403);
  assert.equal(caseDoc.internalNotes[0].note, "First wording");
  const edited = await call(ctrl.updateInternalNote, { user: writer, params: { id: String(caseDoc._id), noteId }, body: { note: "  Second wording  " } });
  assert.equal(edited.status, 200);
  assert.equal(caseDoc.internalNotes[0].note, "Second wording");
  assert.equal(caseDoc.internalNotes[0].editHistory[0].previousNote, "First wording");
  assert.equal(String(caseDoc.internalNotes[0].editHistory[0].editedBy), String(writer._id));
  assert.equal(live.mock.callCount(), 1);
});

test("any internal staff member deletes a note: kept on the record (deletedAt / deletedBy), not editable or deletable again", async (t) => {
  const { caseDoc, live } = setup(t);
  caseDoc.internalNotes.push({ author: writer._id, note: "To be removed" });
  const noteId = String(caseDoc.internalNotes[0]._id);
  const out = await call(ctrl.deleteInternalNote, { user: otherCm, params: { id: String(caseDoc._id), noteId } });
  assert.equal(out.status, 200);
  assert.equal(caseDoc.internalNotes.length, 1, "kept for the audit trail");
  assert.ok(caseDoc.internalNotes[0].deletedAt);
  assert.equal(String(caseDoc.internalNotes[0].deletedBy), String(otherCm._id));
  assert.equal(live.mock.callCount(), 1);
  assert.equal((await call(ctrl.deleteInternalNote, { user: admin, params: { id: String(caseDoc._id), noteId } })).status, 404);
  assert.equal((await call(ctrl.updateInternalNote, { user: writer, params: { id: String(caseDoc._id), noteId }, body: { note: "x" } })).status, 404);
});

test("unknown or malformed note ids are 404, never an error", async (t) => {
  const { caseDoc } = setup(t);
  assert.equal((await call(ctrl.deleteInternalNote, { user: admin, params: { id: String(caseDoc._id), noteId: String(oid()) } })).status, 404);
  assert.equal((await call(ctrl.updateInternalNote, { user: admin, params: { id: String(caseDoc._id), noteId: "not-an-id" }, body: { note: "x" } })).status, 404);
});
