const assert = require("node:assert/strict");
const test = require("node:test");
const router = require("../admin.routes");
const ctrl = require("../admin.controller");
const demoDataService = require("../demo-data.service");
const User = require("../../../models/User");
const Client = require("../../../models/Client");
const Case = require("../../../models/Case");
const Company = require("../../../models/Company");
const Document = require("../../../models/Document");
const Task = require("../../../models/Task");
const Message = require("../../../models/Message");
const Conversation = require("../../../models/Conversation");
const Answer = require("../../../models/Answer");
const StaffPerformance = require("../../../models/StaffPerformance");
const ReportExecution = require("../../../models/ReportExecution");
const EODReport = require("../../../models/EODReport");
const Questionnaire = require("../../../models/Questionnaire");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISMappingVersion = require("../../../models/USCISMappingVersion");
const PackageDefinition = require("../../../models/PackageDefinition");
const WorkflowTemplate = require("../../../models/WorkflowTemplate");
const Settings = require("../../../models/Settings");
const AuditLog = require("../../../models/AuditLog");

function fakeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function fieldsOf(filter) {
  if (!filter) return [];
  return filter.$or.map((clause) => Object.keys(clause)[0]);
}

test("DELETE /demo-data is registered super_admin-only", () => {
  const layer = router.stack.find((entry) => entry.route?.path === "/demo-data");
  assert.ok(layer, "/demo-data route must be registered");
  assert.ok(layer.route.methods.delete, "route must respond to DELETE");
  // authenticate + authorizeRoles("admin","super_admin") run at the router level
  // (router.use); this asserts the route ALSO carries its own narrower
  // authorizeRoles("super_admin") layer in front of the controller handler.
  assert.equal(layer.route.stack.length, 2, "expected an extra super_admin authorizeRoles layer plus the controller handler");
});

test("purgeDemoData controller rejects a missing/incorrect confirm payload without calling the service", async (t) => {
  let serviceCalled = false;
  t.mock.method(demoDataService, "purgeDemoData", async () => { serviceCalled = true; throw new Error("must not be called"); });

  for (const body of [{}, { confirm: "delete_demo_data" }, { confirm: "DELETE" }]) {
    const res = fakeRes();
    await ctrl.purgeDemoData({ body, user: { _id: "admin-1", role: "super_admin" } }, res, (err) => { throw err; });
    assert.equal(res.statusCode, 400);
    assert.equal(serviceCalled, false);
  }
});

test("purgeDemoData controller invokes the service and returns its result on the correct confirm payload", async (t) => {
  let serviceCalled = false;
  t.mock.method(demoDataService, "purgeDemoData", async () => {
    serviceCalled = true;
    return { deleted: { users: 1 }, orphanedReferences: {} };
  });
  t.mock.method(AuditLog, "create", async () => ({}));

  const res = fakeRes();
  await ctrl.purgeDemoData(
    { body: { confirm: "DELETE_DEMO_DATA" }, user: { _id: "admin-1", role: "super_admin" }, ip: "127.0.0.1", get: () => undefined },
    res,
    (err) => { throw err; }
  );
  assert.equal(serviceCalled, true);
  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.deleted, { users: 1 });
});

test("purgeDemoData service matches dependent records by ownership/linkage fields, never staff-assignment or library fields", async (t) => {
  const userIds = ["user-1"];
  const clientIds = ["client-1"];
  const caseIds = ["case-1"];
  const companyIds = ["company-1"];
  const callOrder = [];

  t.mock.method(User, "distinct", async () => userIds);
  t.mock.method(Client, "distinct", async () => clientIds);
  t.mock.method(Case, "distinct", async () => caseIds);
  t.mock.method(Company, "distinct", async () => companyIds);
  t.mock.method(Conversation, "distinct", async () => ["conversation-1"]);

  const captured = {};
  t.mock.method(Message, "deleteMany", async (filter) => { captured.message = filter; callOrder.push("message"); return { deletedCount: 0 }; });
  t.mock.method(Conversation, "deleteMany", async (filter) => { captured.conversation = filter; callOrder.push("conversation"); return { deletedCount: 0 }; });
  t.mock.method(Document, "deleteMany", async (filter) => { captured.document = filter; return { deletedCount: 0 }; });
  t.mock.method(Task, "deleteMany", async (filter) => { captured.task = filter; return { deletedCount: 0 }; });
  t.mock.method(Answer, "deleteMany", async (filter) => { captured.answer = filter; return { deletedCount: 0 }; });
  t.mock.method(StaffPerformance, "deleteMany", async (filter) => { captured.staffPerformance = filter; return { deletedCount: 0 }; });
  t.mock.method(ReportExecution, "deleteMany", async (filter) => { captured.reportExecution = filter; return { deletedCount: 0 }; });
  t.mock.method(EODReport, "deleteMany", async (filter) => { captured.eodReport = filter; return { deletedCount: 0 }; });
  t.mock.method(Case, "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(Client, "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(Company, "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(User, "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(Case, "countDocuments", async () => 0);
  t.mock.method(User, "countDocuments", async () => 0);

  await demoDataService.purgeDemoData();

  assert.deepEqual(fieldsOf(captured.document).sort(), ["caseId", "client", "companyId", "user"].sort());
  assert.ok(!fieldsOf(captured.document).includes("uploadedBy"), "Document.uploadedBy is a role-string enum, never an id-match field");

  assert.deepEqual(fieldsOf(captured.task).sort(), ["caseId", "clientId", "companyId"].sort());
  assert.ok(!fieldsOf(captured.task).includes("assignedTo") && !fieldsOf(captured.task).includes("assignedBy"), "staff-assignment fields must never be matched");

  assert.deepEqual(fieldsOf(captured.answer).sort(), ["caseId", "user", "clientId", "client", "companyId"].sort());
  assert.ok(!fieldsOf(captured.answer).includes("questionnaire") && !fieldsOf(captured.answer).includes("question"), "Answer.questionnaire/question point at protected library data");

  assert.deepEqual(fieldsOf(captured.staffPerformance), ["staff"]);
  assert.deepEqual(fieldsOf(captured.reportExecution), ["generatedBy"]);
  assert.deepEqual(fieldsOf(captured.eodReport).sort(), ["staff", "reviewedBy"].sort());

  assert.ok(callOrder.indexOf("message") < callOrder.indexOf("conversation"), "messages must be deleted before their conversations");
});

test("purgeDemoData service never touches protected library/config collections", async (t) => {
  t.mock.method(User, "distinct", async () => []);
  t.mock.method(Client, "distinct", async () => []);
  t.mock.method(Case, "distinct", async () => []);
  t.mock.method(Company, "distinct", async () => []);
  t.mock.method(Conversation, "distinct", async () => []);
  for (const Model of [Message, Conversation, Document, Task, Answer, StaffPerformance, ReportExecution, EODReport, Case, Client, Company, User]) {
    t.mock.method(Model, "deleteMany", async () => ({ deletedCount: 0 }));
  }
  t.mock.method(Case, "countDocuments", async () => 0);
  t.mock.method(User, "countDocuments", async () => 0);

  for (const Model of [Questionnaire, USCISFormTemplate, USCISMappingVersion, PackageDefinition, WorkflowTemplate, Settings, AuditLog]) {
    t.mock.method(Model, "deleteMany", async () => { throw new Error(`${Model.modelName} must never be deleted by the demo-data purge`); });
  }

  await assert.doesNotReject(() => demoDataService.purgeDemoData());
});

test("purgeDemoData service is a safe no-op on an empty database (no $or:[] queries, all counts zero)", async (t) => {
  t.mock.method(User, "distinct", async () => []);
  t.mock.method(Client, "distinct", async () => []);
  t.mock.method(Case, "distinct", async () => []);
  t.mock.method(Company, "distinct", async () => []);
  t.mock.method(Conversation, "distinct", async () => { throw new Error("Conversation.distinct must be skipped entirely when there are no ids to match"); });

  const shouldNotBeCalled = (Model) => t.mock.method(Model, "deleteMany", async (filter) => {
    assert.notDeepEqual(filter, { $or: [] }, "must never issue an empty $or filter");
    throw new Error(`${Model.modelName}.deleteMany should be skipped when there is nothing to match`);
  });
  [Message, Conversation, Document, Task, Answer, StaffPerformance, ReportExecution, EODReport].forEach(shouldNotBeCalled);

  t.mock.method(Case, "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(Client, "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(Company, "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(User, "deleteMany", async () => ({ deletedCount: 0 }));
  t.mock.method(Case, "countDocuments", async () => 0);
  t.mock.method(User, "countDocuments", async () => 0);

  const { deleted } = await demoDataService.purgeDemoData();
  Object.values(deleted).forEach((count) => assert.equal(count, 0));
});
