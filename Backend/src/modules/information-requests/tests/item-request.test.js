const assert = require("node:assert/strict");
const { test, mock, afterEach } = require("node:test");
const mongoose = require("mongoose");

const Task = require("../../../models/Task");
const User = require("../../../models/User");
const caseService = require("../../cases/case.service");
const notificationService = require("../../notifications/notification.service");
const questionnaireService = require("../../questionnaires/questionnaire.service");
const service = require("../information-request.service");
const fields = require("../requested-fields");
const emailTemplate = require("../../email/templates/additional-info-requested");

// "Request" on an item that is already on the client's checklist: required for THIS case only, e-mailed to the client, idempotent.
// Mock-based: no database connection is opened.
afterEach(() => mock.restoreAll());
const oid = () => new mongoose.Types.ObjectId();

const req = (overrides) => ({ _id: oid(), scope: "existing_question", questionKey: "passport_copy", responseId: "resp-1", status: "open", requestedAt: new Date(), description: "Please re-upload", ...overrides });

test("only open/answered item requests on THIS response make a question required; withdrawn ones do not", () => {
  const caseData = { informationRequests: [
    req({ questionKey: "a" }),
    req({ questionKey: "b", status: "submitted" }),
    req({ questionKey: "c", status: "approved" }),
    req({ questionKey: "d", status: "closed" }), // withdrawn
    req({ questionKey: "e", responseId: "someone-else" }), // another client's checklist
    req({ questionKey: "f", scope: "new_item" }), // the original flow, not an item request
    req({ questionKey: undefined }),
  ] };
  assert.deepEqual([...fields.requestedKeysFromCases([caseData], "resp-1")].sort(), ["a", "b", "c"]);
  assert.equal(fields.requestedKeysFromCases([caseData], "").size, 0);
  assert.equal(fields.requestedKeysFromCases([null, undefined], "resp-1").size, 0, "missing cases never throw");
});

test("applyRequestedRequirement makes a requested question required even when optional, flags it for the client, and leaves the rest untouched", () => {
  const optional = { _id: "1", key: "passport_copy", label: "Passport", required: false, metadata: { optional: true } };
  const other = { _id: "2", key: "other", label: "Other", required: false, metadata: { optional: true } };
  const map = fields.requestMapFromCases([{ informationRequests: [req()] }], "resp-1");
  const [changed, untouched] = fields.applyRequestedRequirement([optional, other], map);
  assert.equal(changed.required, true);
  assert.equal(changed.metadata.optional, false);
  assert.equal(changed.metadata.requestedByStaff.note, "Please re-upload");
  assert.match(changed.description, /Requested by your case manager: Please re-upload/);
  assert.equal(optional.description, undefined, "the shared question's own text is untouched");
  assert.equal(untouched, other, "a question that was not requested is the very same object");
  assert.equal(optional.required, false, "the stored/shared question is never mutated");
  assert.equal(fields.applyRequestedRequirement([optional], new Map())[0], optional);
});

test("isQuestionRequired: a requested key wins over 'optional'; without a request nothing changes", () => {
  const optional = { key: "x", required: false, metadata: { optional: true } };
  assert.equal(questionnaireService.isQuestionRequired(optional, {}), false);
  assert.equal(questionnaireService.isQuestionRequired(optional, {}, new Set()), false);
  assert.equal(questionnaireService.isQuestionRequired(optional, {}, new Set(["y"])), false);
  assert.equal(questionnaireService.isQuestionRequired(optional, {}, new Set(["x"])), true);
  assert.equal(questionnaireService.isQuestionRequired({ key: "r", required: true }, {}), true);
});

// ── creating / re-sending / withdrawing a request ──────────────────────────────────────────────────────────────────────────────────
const actor = { _id: oid(), name: "Cathy CaseManager", role: "case_manager" };

function world({ caseData, question = { key: "passport_copy", label: "Passport copy", type: "file" }, role = "employee" }) {
  const sent = { tasks: [], notifications: [] };
  mock.method(User, "find", () => ({ select: () => ({ lean: async () => [
    { _id: caseData.employerUser, name: "Erin Employer", email: "erin@corp.com" },
    { _id: caseData.employeeUser, name: "Eli Employee", email: "eli@corp.com" },
  ] }) }));
  mock.method(Task, "create", async (payload) => { const task = { _id: oid(), ...payload }; sent.tasks.push(task); return task; });
  mock.method(notificationService, "createNotification", async (payload) => { sent.notifications.push(payload); return payload; });
  mock.method(caseService, "writeAuditLog", async () => {});
  mock.method(questionnaireService, "getQuestionnaireForCase", async () => ({
    questionnaire: { _id: oid(), checklistRole: role }, responseId: "resp-1", questions: [question],
  }));
  return sent;
}

function makeCase() {
  return {
    _id: oid(), caseNumber: "CASE-9", caseStructure: "employer_employee", employerUser: oid(), employeeUser: oid(), participants: [],
    questionnaireReferences: [{ _id: oid(), active: true, responseId: "resp-1", status: "submitted" }],
    informationRequests: [], timeline: [], auditHistory: [], save: async () => {},
  };
}

test("Request on a document: becomes required for the case, goes to the checklist owner, e-mails the details, re-opens a submitted checklist", async () => {
  const caseData = makeCase();
  const sent = world({ caseData });
  const result = await service.createItemRequest(caseData, { questionKey: "passport_copy", targetRole: "employee", note: "The scan is blurry - please upload a clear copy." }, actor);

  assert.equal(result.resent, false);
  assert.equal(result.recipient.role, "employee");
  assert.equal(caseData.informationRequests.length, 1);
  const stored = caseData.informationRequests[0];
  assert.equal(stored.scope, "existing_question");
  assert.equal(stored.questionKey, "passport_copy");
  assert.equal(stored.responseId, "resp-1");
  assert.equal(stored.itemKind, "document");
  assert.equal(caseData.questionnaireReferences[0].status, "in_progress", "a finished checklist is re-opened");
  assert.equal(sent.tasks.length, 1);
  // the e-mail: template, recipient, the item, the case manager's details, and that it is now required
  assert.equal(sent.notifications.length, 1);
  const note = sent.notifications[0];
  assert.equal(note.emailTemplate, "additional-info-requested");
  assert.equal(note.emailTo, "eli@corp.com");
  assert.equal(note.emailData.itemName, "Passport copy");
  assert.equal(note.emailData.details, "The scan is blurry - please upload a clear copy.");
  assert.equal(note.emailData.required, true);
  // and the request now makes that question required for this response
  assert.deepEqual([...fields.requestedKeysFromCases([caseData], "resp-1")], ["passport_copy"]);
});

test("asking again for the same item re-sends the e-mail (with the new note) instead of creating a second request", async () => {
  const caseData = makeCase();
  const sent = world({ caseData });
  await service.createItemRequest(caseData, { questionKey: "passport_copy", targetRole: "employee", note: "first" }, actor);
  const again = await service.createItemRequest(caseData, { questionKey: "passport_copy", targetRole: "employee", note: "second" }, actor);
  assert.equal(again.resent, true);
  assert.equal(caseData.informationRequests.length, 1);
  assert.equal(caseData.informationRequests[0].description, "second");
  assert.equal(sent.tasks.length, 1, "no second task");
  assert.equal(sent.notifications.length, 2);
  assert.equal(sent.notifications[1].emailData.details, "second");
});

test("a text question is requested as information, not as a document", async () => {
  const caseData = makeCase();
  const sent = world({ caseData, question: { key: "salary", label: "Annual salary", type: "number" } });
  await service.createItemRequest(caseData, { questionKey: "salary", targetRole: "employee" }, actor);
  assert.equal(caseData.informationRequests[0].itemKind, "text");
  assert.equal(sent.notifications[0].emailData.itemKind, "information");
});

test("a question that is not on the case's checklist is refused, nothing is stored or sent", async () => {
  const caseData = makeCase();
  const sent = world({ caseData });
  await assert.rejects(() => service.createItemRequest(caseData, { questionKey: "does_not_exist", targetRole: "employee" }, actor), (error) => error.status === 404);
  await assert.rejects(() => service.createItemRequest(caseData, { questionKey: "", targetRole: "employee" }, actor), (error) => error.status === 400);
  assert.equal(caseData.informationRequests.length, 0);
  assert.equal(sent.notifications.length, 0);
});

test("when two people could own the checklist the case manager must choose (409 RECIPIENT_REQUIRED), and a stranger is refused", async () => {
  const caseData = { ...makeCase(), participants: [] };
  world({ caseData });
  // two employees on one case: role match is ambiguous
  const extraEmployee = oid();
  caseData.participants = [{ _id: oid(), role: "employee", status: "active", userId: extraEmployee, name: "Second Employee", email: "two@corp.com" }];
  await assert.rejects(
    () => service.createItemRequest(caseData, { questionKey: "passport_copy", targetRole: "employee" }, actor),
    (error) => error.code === "RECIPIENT_REQUIRED" && error.details.recipients.length >= 2
  );
  await assert.rejects(() => service.createItemRequest(caseData, { questionKey: "passport_copy", targetRole: "employee", recipientId: "f:employee:not-on-case" }, actor), (error) => error.status === 400);
});

test("withdrawing a request stops the requirement; the answer is kept; a mistaken id is a 404", async () => {
  const caseData = makeCase();
  world({ caseData });
  mock.method(Task, "updateOne", async () => ({}));
  const { request } = await service.createItemRequest(caseData, { questionKey: "passport_copy", targetRole: "employee" }, actor);
  assert.equal(fields.requestedKeysFromCases([caseData], "resp-1").size, 1);
  await service.cancelItemRequest(caseData, request._id, actor);
  assert.equal(caseData.informationRequests[0].status, "closed");
  assert.equal(fields.requestedKeysFromCases([caseData], "resp-1").size, 0);
  await assert.rejects(() => service.cancelItemRequest(caseData, oid(), actor), (error) => error.status === 404);
  // an original-flow request cannot be withdrawn through this path
  caseData.informationRequests.push({ _id: oid(), scope: "new_item", status: "open", title: "x" });
  await assert.rejects(() => service.cancelItemRequest(caseData, caseData.informationRequests[1]._id, actor), (error) => error.status === 404);
});

test("the e-mail says the item is now required only for item requests; the original wording is unchanged", () => {
  const withRequired = emailTemplate.bodyLines({ itemName: "Passport copy", itemKind: "document", details: "Clear scan", required: true, portalLink: "https://p/x" }).join(" ");
  assert.match(withRequired, /now required/);
  assert.match(withRequired, /Clear scan/);
  const original = emailTemplate.bodyLines({ itemName: "Passport copy", itemKind: "document", details: "Passport copy", portalLink: "https://p/x" }).join(" ");
  assert.doesNotMatch(original, /now required/);
});
