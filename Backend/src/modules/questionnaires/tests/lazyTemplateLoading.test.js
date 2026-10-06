// Regression: server start-up and unrelated page loads must not reconcile every built-in checklist template
// (which runs Question.find once per template). Templates are reconciled lazily, only the ones a request needs.
// Pure tests - models are stubbed, no database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Question = require("../../../models/Question");
const Questionnaire = require("../../../models/Questionnaire");
const Case = require("../../../models/Case");
const service = require("../questionnaire.service");
const controller = require("../questionnaire.controller");

const SRC = path.join(__dirname, "..", "..", "..");

// Counts Question.find / Questionnaire.* calls; reconcileDefinition's creates are stubbed to in-memory no-ops.
function stubModels(t) {
  const calls = { questionFind: [], questionnaireFindOne: 0, questionnaireFind: 0 };
  const restore = [];
  const stub = (target, name, impl) => { const original = target[name]; target[name] = impl; restore.push(() => { target[name] = original; }); };
  stub(Question, "find", (query) => { calls.questionFind.push(query); return Promise.resolve([]); });
  stub(Question, "bulkWrite", async () => ({}));
  stub(Questionnaire, "findOne", async () => { calls.questionnaireFindOne += 1; return null; });
  stub(Questionnaire, "create", async (doc) => ({ ...doc, _id: `id-${doc.key}`, version: 1, status: "draft", auditHistory: [], save: async () => {}, toObject() { return this; } }));
  t.after(() => restore.reverse().forEach((fn) => fn()));
  return { calls, stub };
}

test("server start-up does not reconcile questionnaire templates", () => {
  const source = fs.readFileSync(path.join(SRC, "server.js"), "utf8");
  const calls = [...source.matchAll(/ensureDefaultVisaTemplates\(/g)];
  // the only call left is the explicit opt-in flag
  assert.equal(calls.length, 1);
  const flagBlock = source.slice(source.indexOf("SEED_QUESTIONNAIRE_TEMPLATES_ON_STARTUP"));
  assert.ok(flagBlock.indexOf("ensureDefaultVisaTemplates(") < 400, "the one remaining call must sit inside the opt-in flag guard");
});

test("GET /questionnaires/defaults lists template metadata only: no Question query, no reconciliation", async (t) => {
  const { calls, stub } = stubModels(t);
  let selected = "";
  stub(Questionnaire, "find", () => {
    calls.questionnaireFind += 1;
    const chain = { select(fields) { selected = fields; return chain; }, sort() { return chain; }, lean: async () => [{ key: "perm_employee_information" }] };
    return chain;
  });
  let body;
  await controller.listDefaultTemplates({ user: { role: "admin" }, method: "GET" }, { json: (value) => { body = value; } }, (error) => { throw error; });
  assert.equal(body.count, 1);
  assert.equal(calls.questionFind.length, 0);
  assert.equal(calls.questionnaireFindOne, 0);
  assert.ok(!/questions|sections|pages/.test(selected), "metadata projection only");
});

const tick = () => new Promise((resolve) => setImmediate(resolve));
const stubPresence = (stub, calls, presentKeys = []) => stub(Questionnaire, "find", () => {
  calls.questionnaireFind += 1;
  const chain = { select() { return chain; }, lean: async () => presentKeys.map((key) => ({ key })) };
  return chain;
});

test("first use of a visa that has no template yet waits for, and creates, only that visa's templates (once)", async (t) => {
  const { calls, stub } = stubModels(t);
  stubPresence(stub, calls, []);
  await service.ensureTemplatesForVisa("PERM", undefined, undefined, { wait: true });
  const permCalls = calls.questionFind.length;
  assert.ok(permCalls >= 1 && permCalls <= 4, `PERM needs a few templates, not all (${permCalls})`);
  await service.ensureTemplatesForVisa("PERM", undefined, undefined, { wait: true });
  assert.equal(calls.questionFind.length, permCalls, "second load is served from the per-template cache");
});

test("a normal page load adds NO database round trip and never waits for a reconcile", async (t) => {
  const { calls, stub } = stubModels(t);
  stubPresence(stub, calls, []);
  await service.ensureTemplatesForVisa("H1B"); // default mode
  assert.equal(calls.questionnaireFind, 0, "no presence query");
  assert.equal(calls.questionFind.length, 0, "no Question query on the request path");
  await tick(); await tick();
  assert.ok(calls.questionFind.length >= 1, "the refresh still happens, in the background");
  const after = calls.questionFind.length;
  await service.ensureTemplatesForVisa("H1B");
  await tick();
  assert.equal(calls.questionFind.length, after, "and only once per TTL");
});

test("a template already stored is never waited on, even with wait:true", async (t) => {
  const { calls, stub } = stubModels(t);
  const defs = ["l1a_questionnaire"];
  stubPresence(stub, calls, defs);
  let release; const gate = new Promise((resolve) => { release = resolve; });
  stub(Question, "find", (query) => { calls.questionFind.push(query); return gate.then(() => []); });
  await service.ensureTemplatesForVisa("L1A", undefined, undefined, { wait: true }); // returns although reconcile is blocked
  assert.equal(calls.questionnaireFind, 1, "one presence query, no reconcile awaited");
  release();
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the background refresh finish
});

test("an unknown visa or key touches no Question data", async (t) => {
  const { calls } = stubModels(t);
  await service.ensureTemplatesForVisa("NOT-A-VISA");
  await service.ensureTemplatesForVisa("");
  assert.equal(await service.ensureTemplate("no_such_checklist_key"), null);
  assert.equal(calls.questionFind.length, 0);
  assert.equal(calls.questionnaireFindOne, 0);
});

test("resolving a case's checklists never runs the global reconcile", async (t) => {
  const { calls, stub } = stubModels(t);
  const caseDoc = { _id: "case1", visaType: "ZZ-UNRELATED", user: "u1", questionnaireReferences: [], participants: [] };
  stub(Case, "findById", () => ({ select: () => ({ lean: async () => caseDoc }) }));
  stub(Questionnaire, "find", () => { calls.questionnaireFind += 1; return { lean: async () => [] }; });
  stub(Questionnaire, "findOne", () => ({ sort: () => ({ lean: async () => null }) }));
  await service.resolveCaseQuestionnaires("case1");
  assert.equal(calls.questionFind.length, 0, "no Question.find for a case whose visa has no built-in template");
});
