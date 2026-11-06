// One-off: change case B489 (Advance Com International USA INC.) from PERM to L-1A IN PLACE - same case, same id, same people, same
// employer profile; nothing is created or deleted except the PERM-only checklists / petition package that no longer apply.
//
// Hard-wired to B489 and its own employee child (B489-A). It refuses to run if either is not what it expects, and it never looks at
// any other case.
//
//   node src/scripts/convertCaseTypeB489.js --backup-dir <dir>              dry run: checks + plan, writes nothing
//   node src/scripts/convertCaseTypeB489.js --backup-dir <dir> --apply      backs up, converts, verifies against a real L-1A case
//   node src/scripts/convertCaseTypeB489.js --backup-dir <dir> --rollback <backup.json>
//
// NO EMAIL / NO NOTIFICATION: EMAIL_SUPPRESS_ALL and NOTIFICATIONS_SUPPRESS_ALL are forced ON for this process before anything is
// loaded (suppressed mail is only logged as "skipped", never queued), and the "case created" notification step is not run at all.
// Only THIS script process is affected; the running backend keeps its own settings.
//
// GHL: field changes are written straight to the collection, so the Case save hooks that queue a GoHighLevel sync do not fire - the
// GHL card is left exactly as it is (see the report).
process.env.EMAIL_SUPPRESS_ALL = "true";
process.env.NOTIFICATIONS_SUPPRESS_ALL = "true";
require("dotenv").config({ override: false });
process.env.EMAIL_SUPPRESS_ALL = "true";
process.env.NOTIFICATIONS_SUPPRESS_ALL = "true";

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const CASE_ID = "B489";
const FROM = "PERM";
const TO = "L-1A";
const REFERENCE_CASE_ID = "B476"; // a normal L-1A employer matter, used only to compare the result against
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const APPLY = process.argv.includes("--apply");
const ROLLBACK = arg("--rollback");
const BACKUP_DIR = arg("--backup-dir") || path.join(__dirname, "..", "..", "backups");

const say = (...a) => console.log(...a);
const fail = (message) => { throw new Error(message); };
const oid = (v) => String(v?._id || v || "");

async function load(db) {
  const principal = await db.collection("cases").findOne({ caseId: CASE_ID });
  if (!principal) fail(`case ${CASE_ID} not found`);
  const children = await db.collection("cases").find({ parentCase: principal._id }).toArray();
  return { principal, children };
}

function checkPreconditions({ principal, children }, counts) {
  if (principal.caseNumber !== CASE_ID) fail("unexpected case number");
  if (principal.visaType !== FROM || principal.visaCategory !== FROM) fail(`principal is not ${FROM}`);
  if (children.length !== 1 || children[0].caseNumber !== `${CASE_ID}-A`) fail(`expected exactly one employee case ${CASE_ID}-A`);
  const child = children[0];
  if (child.visaType !== FROM) fail(`employee case is not ${FROM}`);
  const answered = (principal.questionnaireData?.answeredQuestionKeys || []).length + (child.questionnaireData?.answeredQuestionKeys || []).length;
  if (answered) fail(`${answered} checklist answer(s) already exist - not converting automatically`);
  const refs = [...(principal.questionnaireReferences || []), ...(child.questionnaireReferences || [])];
  const touched = refs.filter((r) => r.status && r.status !== "not_started");
  if (touched.length) fail("a checklist has already been started - not converting automatically");
  if (child.employeeInvite?.status) fail("the employee has already been invited");
  for (const [name, n] of Object.entries(counts)) if (n) fail(`${n} record(s) in ${name} - not converting automatically`);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000 });
  const db = mongoose.connection.db;
  say(`${ROLLBACK ? "ROLLBACK" : APPLY ? "APPLY" : "DRY RUN"} - case ${CASE_ID}: ${FROM} -> ${TO}   (EMAIL_SUPPRESS_ALL / NOTIFICATIONS_SUPPRESS_ALL forced on for this process)`);

  if (ROLLBACK) return rollback(db);

  const state = await load(db);
  const { principal } = state;
  const child = state.children[0];
  const ids = [principal._id, child._id];
  const counts = {};
  for (const name of ["documents", "casedocuments", "documentuploadsessions", "payments", "appointments", "messages", "conversations", "answers"]) {
    counts[name] = await db.collection(name).countDocuments({ $or: [{ caseId: { $in: ids } }, { case: { $in: ids } }] }).catch(() => 0);
  }
  checkPreconditions(state, counts);
  say("preconditions OK: both cases are", FROM, "- no answers, no started checklists, no documents/payments/messages, employee not invited");

  const ref = await db.collection("cases").findOne({ caseId: REFERENCE_CASE_ID });
  const refChild = await db.collection("cases").findOne({ parentCase: ref._id });
  if (ref.visaType !== TO) fail("reference case is not L-1A");
  say("will set on", `${principal.caseNumber} and ${child.caseNumber}:`, `visaType/visaCategory/petitionType ${FROM} -> ${TO}, pipelineCategory ${principal.pipelineCategory} -> ${ref.pipelineCategory}`);
  say("will remove: the PERM employer/employee checklists, the PERM knowledge plan, the PERM petition package");
  say("will add (by the app's own provisioning, as at case creation): L-1A employer + employee checklists, I-129 form set, L-1A document checklist, L-1A petition package");
  say("reference (normal L-1A):", `principal checklist docs=${(ref.documentChecklist || []).length}`, `employee checklist docs=${(refChild.documentChecklist || []).length}`);
  if (!APPLY) return say("nothing written (add --apply to convert)");

  // ---- backup -------------------------------------------------------------
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const startedAt = new Date();
  const backup = {
    startedAt,
    cases: [principal, child],
    employerprofiles: await db.collection("employerprofiles").find({ _id: principal.employerProfileId }).toArray(),
    employeeprofiles: await db.collection("employeeprofiles").find({ caseId: { $in: ids } }).toArray(),
    petitionpackages: await db.collection("petitionpackages").find({ caseId: { $in: ids } }).toArray(),
  };
  const backupFile = path.join(BACKUP_DIR, `B489-before-L1A-${startedAt.toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup));
  say("backup written:", backupFile);

  // ---- 1. the case type itself (direct writes: no save hooks, so no GHL sync is queued) --------
  const Case = require("../models/Case");
  const { resolveDocumentRequirements } = require("../modules/document-requirements/document-requirement.resolver");
  const templates = await db.collection("questionnairetemplates").find({ _id: { $in: [...(principal.questionnaireReferences || []), ...(child.questionnaireReferences || [])].map((r) => r.questionnaireTemplateId || r.questionnaireId).filter(Boolean) } }).project({ key: 1, title: 1 }).toArray().catch(() => []);
  const isPerm = (r) => /^PERM\b/i.test(r.title || "") || templates.some((t) => oid(t._id) === oid(r.questionnaireTemplateId || r.questionnaireId) && /^perm_/i.test(t.key || ""));
  const required = await resolveDocumentRequirements(TO);
  const applicable = required.filter((item) => !item.questionnaireOnly);
  const employeeList = applicable.filter((item) => !item.targetRole || item.targetRole === "employee");
  const visaFields = { visaType: TO, visaCategory: TO, petitionType: TO, pipelineCategory: ref.pipelineCategory };

  await db.collection("cases").updateOne({ _id: principal._id, visaType: FROM }, {
    $set: { ...visaFields, questionnaireReferences: (principal.questionnaireReferences || []).filter((r) => !isPerm(r)), documentChecklist: required, checklistItems: required, "participants.$[p].questionnaireId": null, "participants.$[p].responseId": null },
    $unset: { petitionSubType: "", knowledgePlan: "" },
  }, { arrayFilters: [{ "p.role": "employer" }] });
  await db.collection("cases").updateOne({ _id: child._id, visaType: FROM }, {
    $set: { ...visaFields, questionnaireReferences: (child.questionnaireReferences || []).filter((r) => !isPerm(r)), documentChecklist: employeeList, checklistItems: employeeList },
    $unset: { petitionSubType: "", knowledgePlan: "" },
  });
  await db.collection("petitionpackages").deleteMany({ caseId: { $in: ids }, packageDefinitionKey: /^PERM/ });
  say("case type fields switched");

  // ---- 2. the app's own provisioning, as run at case creation (minus the 'case created' notification) ----
  const User = require("../models/User");
  const user = await User.findById(principal.createdBy);
  const req = { headers: {}, ip: "script", get: () => undefined, user };
  const lifecycle = require("../modules/cases/case-lifecycle-orchestrator.service");
  const engine = require("../modules/cases/immigration-knowledge-engine.service");
  const step = async (name, run) => { try { await run(); say("  ok  ", name); } catch (error) { say("  FAIL", name, "-", error.message); } };
  const fresh = () => Case.findById(principal._id);
  await step("knowledge engine (forms, questionnaires, documents plan)", () => engine.orchestrate(principal._id, user, req, { reason: "case_classification_changed" }));
  await step("employer L-1A checklist", () => require("../modules/questionnaires/employer-visa-checklists.service").ensureEmployerChecklistForVisa(principal._id, { visaType: TO }, user, req));
  await step("employee case checklist", () => lifecycle.orchestrateOne(child._id, user, req));
  await step("USCIS forms (I-129 set)", async () => lifecycle.provisionRequiredForms(await fresh(), user, req));
  await step("petition draft", async () => lifecycle.provisionPetitionDraft(await fresh(), user, req));
  await step("checklist assignments", async () => lifecycle.provisionChecklistAssignments(await fresh(), user, req));
  await step("inherit approvals", () => require("../modules/questionnaires/case-checklist.service").inheritParentApprovals(principal._id, user));
  await step("recalculate", () => lifecycle.recalculate(principal._id, user, req, "case_type_changed"));
  await step("audit entry", async () => {
    const doc = await fresh();
    require("../modules/cases/case.service").addAuditEntry(doc, "case_type_changed", `Case type changed from ${FROM} to ${TO}`, user, { visaType: { from: FROM, to: TO } }, req);
    await doc.save();
  });

  // ---- 3. verify against a real L-1A case --------------------------------------------------------
  const after = await load(db);
  const aChild = after.children[0];
  const shape = (c, forms) => ({
    visaType: c.visaType, visaCategory: c.visaCategory, petitionType: c.petitionType, pipelineCategory: c.pipelineCategory,
    activeChecklists: (c.questionnaireReferences || []).filter((r) => r.active !== false).map((r) => `${r.title}|${r.targetRole}`).sort(),
    docChecklist: (c.documentChecklist || []).length,
    knowledgeForms: (c.knowledgePlan?.formAssignments || []).map((f) => f.formCode || f.key || f.formId).sort(),
    knowledgeQuestionnaires: (c.knowledgePlan?.questionnaireAssignments || []).map((q) => q.key).sort(),
    caseForms: forms,
  });
  const forms = async (id) => db.collection("caseforms").countDocuments({ caseId: id });
  const pairs = [["principal", after.principal, ref], ["employee case", aChild, refChild]];
  let ok = true;
  for (const [label, got, want] of pairs) {
    const g = shape(got, await forms(got._id));
    const w = shape(want, await forms(want._id));
    const same = JSON.stringify(g) === JSON.stringify(w);
    ok = ok && same;
    say(`\n${label}: ${same ? "MATCHES the normal L-1A case" : "DIFFERS from the normal L-1A case"}`);
    if (!same) { say("  this case:", JSON.stringify(g)); say("  L-1A ref :", JSON.stringify(w)); } else say("  ", JSON.stringify(g));
  }
  const leftovers = await db.collection("petitionpackages").find({ caseId: { $in: ids } }).project({ packageDefinitionKey: 1, status: 1 }).toArray();
  say("\npetition packages now:", JSON.stringify(leftovers));
  say(ok ? "\nVERIFIED" : "\nNOT identical - review above (rollback available: --rollback)", "\nbackup:", backupFile);
}

async function rollback(db) {
  const file = ROLLBACK;
  const backup = JSON.parse(fs.readFileSync(file, "utf8"));
  const { ObjectId } = mongoose.Types;
  const revive = (value) => JSON.parse(JSON.stringify(value), (key, v) => (typeof v === "string" && /^[a-f0-9]{24}$/i.test(v) && (key === "_id" || /(Id|Ref|user|User|By|Case|case|parent|Manager|Lead|Agent|Owner)s?$/.test(key)) ? new ObjectId(v) : (typeof v === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v) ? new Date(v) : v)));
  const ids = backup.cases.map((c) => new ObjectId(c._id));
  for (const c of backup.cases) await db.collection("cases").replaceOne({ _id: new ObjectId(c._id) }, revive(c));
  for (const [coll, docs] of [["employerprofiles", backup.employerprofiles], ["employeeprofiles", backup.employeeprofiles], ["petitionpackages", backup.petitionpackages]]) {
    for (const d of docs) await db.collection(coll).replaceOne({ _id: new ObjectId(d._id) }, revive(d), { upsert: true });
  }
  const since = new Date(backup.startedAt);
  const keepPkg = backup.petitionpackages.map((d) => new ObjectId(d._id));
  const a = await db.collection("petitionpackages").deleteMany({ caseId: { $in: ids }, _id: { $nin: keepPkg }, createdAt: { $gte: since } });
  const b = await db.collection("caseforms").deleteMany({ caseId: { $in: ids }, createdAt: { $gte: since } });
  say(`restored ${backup.cases.length} cases + profiles + packages; removed ${a.deletedCount} new package(s), ${b.deletedCount} new form(s) created since the backup`);
  await mongoose.disconnect();
}

main().then(() => mongoose.disconnect()).catch(async (error) => { console.error("STOPPED:", error.message); await mongoose.disconnect().catch(() => {}); process.exit(1); });
