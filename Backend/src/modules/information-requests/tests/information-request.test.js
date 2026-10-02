const assert = require("node:assert/strict");
const { test, mock, afterEach } = require("node:test");
const mongoose = require("mongoose");

const Question = require("../../../models/Question");
const Questionnaire = require("../../../models/Questionnaire");
const Task = require("../../../models/Task");
const User = require("../../../models/User");
const Case = require("../../../models/Case");
const caseService = require("../../cases/case.service");
const notificationService = require("../../notifications/notification.service");
const service = require("../information-request.service");
const router = require("../information-request.routes");

// Everything below is mock-based: no database connection is opened.
afterEach(() => mock.restoreAll());

const oid = () => new mongoose.Types.ObjectId();

function makeCase(overrides = {}) {
  const informationRequests = [];
  informationRequests.id = (id) => informationRequests.find((item) => String(item._id) === String(id));
  return {
    _id: oid(),
    caseNumber: "CASE-1",
    caseStructure: "employer_employee",
    employerUser: oid(),
    employeeUser: oid(),
    participants: [],
    questionnaireReferences: [],
    informationRequests,
    save: async () => {},
    ...overrides,
  };
}

function usersFor(caseData) {
  return {
    [String(caseData.employerUser)]: { name: "Erin Employer", email: "erin@corp.com" },
    [String(caseData.employeeUser)]: { name: "Eli Employee", email: "eli@corp.com" },
  };
}

test("buildRecipients labels each role that exists on the case as 'Role - Name (email)'", () => {
  const caseData = makeCase({ jointSponsorUser: oid() });
  const users = {
    ...usersFor(caseData),
    [String(caseData.jointSponsorUser)]: { name: "Jo Sponsor", email: "jo@x.com" },
  };
  const recipients = service.buildRecipients(caseData, users);
  assert.deepEqual(recipients.map((item) => item.role).sort(), ["employee", "employer", "joint_sponsor"]);
  assert.ok(recipients.some((item) => item.label === "Employer - Erin Employer (erin@corp.com)"));
  assert.ok(recipients.some((item) => item.label === "Joint Sponsor - Jo Sponsor (jo@x.com)"));
});

test("buildRecipients only lists roles present and resolves a single-person client", () => {
  const userId = oid();
  const caseData = { _id: oid(), caseStructure: "single", user: userId, clientName: "Sam Client", clientEmail: "sam@x.com", participants: [] };
  const recipients = service.buildRecipients(caseData, {});
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].role, "client");
  assert.equal(recipients[0].label, "Client - Sam Client (sam@x.com)");
});

test("buildRecipients dedupes participants against the matching *User fields and reads participant name/email", () => {
  const employeeUser = oid();
  const participantId = oid();
  const caseData = {
    _id: oid(),
    employeeUser,
    participants: [{ _id: participantId, role: "employee", status: "active", userId: employeeUser, name: "Eli Employee", email: "ELI@corp.com" }],
  };
  const recipients = service.buildRecipients(caseData, {});
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].id, `p:${participantId}`);
  assert.equal(recipients[0].email, "eli@corp.com");
});

function stubWorld(t, caseData) {
  const created = { questionnaires: new Map(), questions: [], notifications: [], tasks: [] };
  mock.method(User, "find", () => ({ select: () => ({ lean: async () => Object.entries(usersFor(caseData)).map(([id, user]) => ({ _id: id, ...user })) }) }));
  mock.method(Questionnaire, "findOne", async ({ key }) => created.questionnaires.get(key) || null);
  mock.method(Questionnaire, "create", async (payload) => {
    const doc = { _id: oid(), ...payload };
    created.questionnaires.set(payload.key, doc);
    return doc;
  });
  mock.method(Question, "countDocuments", async ({ questionnaire }) => created.questions.filter((q) => String(q.questionnaire) === String(questionnaire)).length);
  mock.method(Question, "create", async (payload) => {
    created.questions.push(payload);
    return payload;
  });
  mock.method(Task, "create", async (payload) => {
    const task = { _id: oid(), ...payload };
    created.tasks.push(task);
    return task;
  });
  mock.method(notificationService, "createNotification", async (payload) => {
    created.notifications.push(payload);
    return payload;
  });
  mock.method(caseService, "writeAuditLog", async () => {});
  return created;
}

const actor = { _id: oid(), name: "Cathy CaseManager", role: "case_manager" };

test("createRequest appends the row only to the target role's own checklist and never to the other role's", async (t) => {
  const caseData = makeCase();
  const world = stubWorld(t, caseData);
  const [employer, employee] = ["employer", "employee"].map((role) => service.buildRecipients(caseData, usersFor(caseData)).find((item) => item.role === role));

  await service.createRequest(caseData, { recipientId: employee.id, name: "Passport copy", itemKind: "document", documentCategory: "Identity" }, actor);
  await service.createRequest(caseData, { recipientId: employer.id, name: "Number of employees", itemKind: "number" }, actor);

  assert.equal(world.questionnaires.size, 2, "one private checklist per recipient");
  const [employeeChecklist, employerChecklist] = [...world.questionnaires.values()];
  assert.equal(employeeChecklist.checklistRole, "employee");
  assert.equal(employerChecklist.checklistRole, "employer");
  assert.ok(employeeChecklist.tags.includes("staff_request"));
  assert.equal(world.questions.length, 2);
  const passport = world.questions.find((q) => q.label === "Passport copy");
  assert.equal(String(passport.questionnaire), String(employeeChecklist._id));
  assert.equal(passport.type, "file");
  assert.equal(passport.required, true);
  assert.equal(passport.active, true);
  assert.equal(passport.metadata.staffRequested, true);
  assert.equal(passport.metadata.documentType, "Passport copy");
  const count = world.questions.find((q) => q.label === "Number of employees");
  assert.equal(String(count.questionnaire), String(employerChecklist._id));
  assert.equal(count.type, "number");

  // References are flagged staffRequest and scoped to their own role/user.
  const refs = caseData.questionnaireReferences;
  assert.equal(refs.length, 2);
  assert.ok(refs.every((ref) => ref.staffRequest === true));
  assert.deepEqual(refs.map((ref) => ref.targetRole).sort(), ["employee", "employer"]);
  assert.equal(String(refs.find((ref) => ref.targetRole === "employee").assignedTo), String(caseData.employeeUser));
  assert.equal(caseData.informationRequests.length, 2);
  assert.equal(caseData.informationRequests[0].status, undefined, "defaults to open via the schema");
});

test("a second request to the same person reuses their checklist and reopens a finished one", async (t) => {
  const caseData = makeCase();
  const world = stubWorld(t, caseData);
  const employee = service.buildRecipients(caseData, usersFor(caseData)).find((item) => item.role === "employee");
  await service.createRequest(caseData, { recipientId: employee.id, name: "Offer letter", itemKind: "document" }, actor);
  caseData.questionnaireReferences[0].status = "submitted";
  await service.createRequest(caseData, { recipientId: employee.id, name: "Visa status", itemKind: "yes_no" }, actor);
  assert.equal(world.questionnaires.size, 1);
  assert.equal(caseData.questionnaireReferences.length, 1);
  assert.equal(caseData.questionnaireReferences[0].status, "in_progress");
  const yesNo = world.questions.find((q) => q.label === "Visa status");
  assert.equal(yesNo.type, "select");
  assert.deepEqual(yesNo.options.map((option) => option.value), ["Yes", "No"]);
  assert.equal(yesNo.order, 2);
});

test("createRequest asks for in-app, push and email with the additional-info template", async (t) => {
  const caseData = makeCase();
  const world = stubWorld(t, caseData);
  const employee = service.buildRecipients(caseData, usersFor(caseData)).find((item) => item.role === "employee");
  await service.createRequest(caseData, { recipientId: employee.id, name: "Pay stubs", itemKind: "document", description: "Last 3 months" }, actor);
  assert.equal(world.notifications.length, 1);
  const [notification] = world.notifications;
  assert.equal(String(notification.userId), String(caseData.employeeUser));
  assert.equal(notification.type, "additional_information_requested");
  for (const channel of ["in_app", "push", "email"]) assert.ok(notification.channels.includes(channel), channel);
  assert.equal(notification.emailTemplate, "additional-info-requested");
  assert.equal(notification.emailTo, "eli@corp.com");
  assert.equal(notification.emailData.itemName, "Pay stubs");
  assert.match(notification.message, /Cathy CaseManager is asking for this document: Pay stubs/);
  assert.match(notification.emailData.portalLink, /\/dashboard\/documents$/);
});

test("createRequest rejects recipients that are not participants and unsupported input", async (t) => {
  const caseData = makeCase();
  stubWorld(t, caseData);
  const employee = service.buildRecipients(caseData, usersFor(caseData)).find((item) => item.role === "employee");
  await assert.rejects(service.createRequest(caseData, { recipientId: "f:employee:not-on-case", name: "X item", itemKind: "text" }, actor), (error) => error.status === 400);
  await assert.rejects(service.createRequest(caseData, { recipientId: employee.id, name: "Pick", itemKind: "select", options: ["only one"] }, actor), (error) => error.status === 400);
  await assert.rejects(service.createRequest(caseData, { recipientId: employee.id, name: "Weird", itemKind: "hologram" }, actor), (error) => error.status === 400);
});

test("route validation: select needs two options; POST is staff-only", () => {
  const body = (value, itemKind) => ({ req: { body: { itemKind, options: value } } });
  assert.equal(router.hasTwoOptions(["A", "B"], body(["A", "B"], "select")), true);
  assert.equal(router.hasTwoOptions(["A", " "], body(["A", " "], "select")), false);
  assert.equal(router.hasTwoOptions(undefined, body(undefined, "text")), true);

  const layer = router.stack.find((item) => item.route?.path === "/" && item.route.methods.post);
  assert.ok(layer, "POST / registered");
  const roleGuard = layer.route.stack[1].handle; // authenticate, authorizeRoles, permissions, validators..., validate, ctrl
  for (const role of ["client", "employer", "employee", "attorney"]) {
    let status;
    roleGuard({ user: { role } }, { status(code) { status = code; return { json() {} }; } }, () => { status = "next"; });
    assert.equal(status, 403, `${role} must be rejected`);
  }
  let allowed;
  roleGuard({ user: { role: "case_manager" } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});

test("markAnswered flips only answered open requests and notifies the requester", async (t) => {
  const questionnaireId = oid();
  const requestedBy = oid();
  const answered = { _id: oid(), status: "open", questionKey: "req_a", questionnaireId, requestedBy, title: "Passport", recipientName: "Eli" };
  const pending = { _id: oid(), status: "open", questionKey: "req_b", questionnaireId, requestedBy, title: "Visa" };
  const otherChecklist = { _id: oid(), status: "open", questionKey: "req_c", questionnaireId: oid(), requestedBy, title: "Other" };
  mock.method(Case, "findById", () => ({ select: () => ({ lean: async () => ({ caseNumber: "CASE-1", informationRequests: [answered, pending, otherChecklist] }) }) }));
  const updates = [];
  mock.method(Case, "updateOne", async (filter, update) => { updates.push({ filter, update }); return { modifiedCount: 1 }; });
  const notifications = [];
  mock.method(notificationService, "createNotification", async (payload) => { notifications.push(payload); });
  const done = await service.markAnswered({
    caseId: oid(),
    questionnaire: { _id: questionnaireId },
    answerMap: { req_a: { files: [{ originalName: "p.pdf" }], value: ["p.pdf"] }, req_b: { value: "  " }, req_c: { value: "x" } },
    user: { _id: oid() },
  });
  assert.deepEqual(done.map((item) => item.questionKey), ["req_a"]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].update.$set["informationRequests.$.status"], "submitted");
  assert.equal(String(notifications[0].userId), String(requestedBy));
});

test("isAnswered treats 0 and false as answers, blanks as not", () => {
  assert.equal(service.isAnswered({ value: 0 }), true);
  assert.equal(service.isAnswered({ value: false }), true);
  assert.equal(service.isAnswered({ value: "" }), false);
  assert.equal(service.isAnswered({ value: [] }), false);
  assert.equal(service.isAnswered(null), false);
});

test("buildRecipients never shows employer/employee on a family case (incl. the legacy '-A' beneficiary child)", () => {
  const child = makeCase({ caseStructure: "family", caseRole: "beneficiary", employerUser: undefined, employeeUser: oid() });
  const childRecipients = service.buildRecipients(child, { [String(child.employeeUser)]: { name: "Akash", email: "a@x.com" } });
  assert.deepEqual(childRecipients.map((r) => r.roleLabel), ["Beneficiary"]);
  assert.equal(childRecipients[0].role, "beneficiary");

  const shared = makeCase({ caseStructure: "family", employerUser: undefined, employeeUser: undefined, petitionerUser: oid(), beneficiaryUser: oid() });
  const sharedRecipients = service.buildRecipients(shared, {});
  assert.deepEqual(sharedRecipients.map((r) => r.roleLabel).sort(), ["Beneficiary", "Petitioner"]);
});
