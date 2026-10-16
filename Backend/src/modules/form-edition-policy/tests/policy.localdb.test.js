// DB-BACKED tests of the form-edition policy, against the LOCAL test database only (src/test-utils/pipelineDb.js refuses anything else; with no local MongoDB the
// tests are skipped). Real Mongoose models, real indexes, the real store and the real activation path; only the uscis.gov fetches are scripted.
// Every document uses a unique ZZ-PIPE-* form code and is deleted afterwards by that code - nothing else in any database is touched.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase, uniqueFormCode, assertNoCaseFormReferences } = require("../../../test-utils/pipelineDb");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const FormEditionDecision = require("../../../models/FormEditionDecision");
const FormEditionSource = require("../../../models/FormEditionSource");
const FormEditionAuditEvent = require("../../../models/FormEditionAuditEvent");
const AuditLog = require("../../../models/AuditLog");
const { mongoStore } = require("../EditionPolicyStore");
const { createEvidenceService } = require("../EvidenceService");
const { requireAcceptedEdition, EditionPolicyHeldError, setDepsForTests } = require("../EditionPolicyEnforcer");
const VersionManagementService = require("../../uscis-lifecycle/services/VersionManagementService");
const H = require("./helpers");

let db; // set below; the cleanup hook is registered FIRST so it runs before the helper disconnects
test.after(async () => {
  if (!db?.ok || !codes.length) return;
  // exactly the documents of the ZZ-PIPE codes this file created, in every collection that can hold them
  const raw = (name) => mongoose.connection.collection(name);
  const matching = { $regex: `(${codes.join("|")})` };
  const caseIds = await raw(FormEditionAuditEvent.collection.name).distinct("evidenceCaseId", { formCode: { $in: codes } });
  await raw(FormEditionSource.collection.name).deleteMany({ evidenceCaseId: { $in: caseIds } }); // sources carry no form code: found through their evidence case
  await raw(USCISFormTemplate.collection.name).deleteMany({ formCode: { $in: codes } });
  for (const model of [FormEditionDecision, FormEditionAuditEvent]) await raw(model.collection.name).deleteMany({ formCode: { $in: codes } });
  await raw(AuditLog.collection.name).deleteMany({ description: matching });
  // activation also announces itself to staff (a notification whose text names the form) and the notification service audits that
  const notifications = await raw("notifications").find({ message: matching }, { projection: { _id: 1 } }).toArray();
  await raw(AuditLog.collection.name).deleteMany({ entityType: "notification", entityId: { $in: notifications.flatMap((item) => [String(item._id), item._id]) } });
  await raw("notifications").deleteMany({ _id: { $in: notifications.map((item) => item._id) } });
});

db = useTestDatabase({ before: test.before, after: test.after }, [USCISFormTemplate, FormEditionDecision, FormEditionSource, FormEditionAuditEvent]);
const codes = [];
const newCode = () => { const code = uniqueFormCode(); codes.push(code); return code; };
const day = (iso) => new Date(`${iso}T00:00:00Z`);

const PAGE = (edition = "01/20/25") => `Form Details Edition Date ${edition} . Filing tips for this form follow below.`;
const certified = { validationSummary: { certification: { passed: true, checks: [] } } };
const template = (formCode, over = {}) => ({
  formCode, title: `${formCode} test form`, version: "2025-01-20", editionDate: day("2025-01-20"), status: "review", mappingStatus: "active", approvedAt: new Date(), approvedBy: new mongoose.Types.ObjectId(),
  importMetadata: { editionDateSource: "pdf", ...certified }, lifecycle: {}, ...over,
});
const serviceFor = (page) => createEvidenceService({
  store: mongoStore, fetchHtml: H.okFetch(page), fetchPdf: H.pdfFetch(), resolvePageUrl: (code) => `https://www.uscis.gov/${code.toLowerCase()}`, readPrintedEdition: async () => "2025-01-20",
});
const admin = { _id: new mongoose.Types.ObjectId(), role: "admin" };

test("indexes: one decision per form edition, one audit event per sequence number; the audit trail cannot be changed or deleted", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const base = { formCode: code, editionIdentifier: "2025-01-20", decision: "held", status: "unverified", decidedAt: new Date() };
  await FormEditionDecision.create(base);
  await assert.rejects(FormEditionDecision.create(base), (error) => error.code === 11000, "a second decision for the same edition is refused by the unique index");
  await FormEditionDecision.create({ ...base, editionIdentifier: "2026-01-01" }); // another edition of the same form is fine

  const event = { evidenceCaseId: `case-${code}`, seq: 1, type: "EVIDENCE_SUBMITTED", formCode: code, editionIdentifier: "2025-01-20", at: new Date() };
  const saved = await FormEditionAuditEvent.create(event);
  await assert.rejects(FormEditionAuditEvent.create(event), (error) => error.code === 11000, "the same sequence number twice is refused");
  await assert.rejects(FormEditionAuditEvent.updateOne({ _id: saved._id }, { $set: { type: "CHANGED" } }), /append|immutable|cannot/i, "update refused");
  await assert.rejects(FormEditionAuditEvent.deleteOne({ _id: saved._id }), /append|immutable|cannot/i, "delete refused");
  saved.type = "SOURCE_FETCHED"; // a valid type, so it is the append-only guard (not validation) that must refuse
  await assert.rejects(saved.save(), /append|immutable|cannot|modif/i, "save of a changed event refused");
  assert.equal((await FormEditionAuditEvent.findById(saved._id).lean()).type, "EVIDENCE_SUBMITTED");
});

test("end to end on real models: held without a decision (live edition untouched), accepted automatically, then activation retires the old edition", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const live = await USCISFormTemplate.create(template(code, { version: "2024-04-01", editionDate: day("2024-04-01"), status: "active", activeFlag: true, currentStatus: "active" }));
  const candidate = await USCISFormTemplate.create(template(code));
  await assertNoCaseFormReferences([live._id, candidate._id]);
  const service = serviceFor(PAGE());
  setDepsForTests({ store: mongoStore, service, autoEvidence: false });

  // 1) no decision yet: the activation is held and NOTHING changes
  await assert.rejects(VersionManagementService.activate(candidate._id, admin, {}), (error) => error instanceof EditionPolicyHeldError && error.status === 409 && error.details.reasons.includes("no_policy"));
  assert.equal((await USCISFormTemplate.findById(live._id).lean()).status, "active");
  assert.equal((await USCISFormTemplate.findById(candidate._id).lean()).status, "review");
  assert.equal(await FormEditionDecision.countDocuments({ formCode: code }), 0, "a hold writes no decision");

  // 2) the automatic check reads the (scripted) official page and records the decision in the real collections
  const result = await service.runAutomaticCheck(code, "2025-01-20", { trigger: "test" });
  assert.equal(result.outcome, "accepted");
  assert.equal(result.pattern, "current_official_edition");
  const decision = await FormEditionDecision.findOne({ formCode: code, editionIdentifier: "2025-01-20" }).lean();
  assert.deepEqual([decision.decision, decision.status, decision.decidedBy.label], ["accepted", "verified", "pipeline:official_source"]);
  assert.equal(await FormEditionSource.countDocuments({ formCode: code }) + await FormEditionSource.countDocuments({ evidenceCaseId: result.evidenceCaseId }) > 0, true, "the snapshot was stored");
  const events = await FormEditionAuditEvent.find({ evidenceCaseId: result.evidenceCaseId }).sort({ seq: 1 }).lean();
  assert.deepEqual(events.map((event) => event.type), ["EVIDENCE_SUBMITTED", "SOURCE_FETCHED", "VERIFICATION_COMPLETED", "DECISION_RECORDED", "GATE_RECALCULATED"]);

  // 3) the gate now allows it and the existing activation path promotes it exactly as before
  assert.equal((await requireAcceptedEdition(candidate, { entryPoint: "test" })).allowed, true);
  const activated = await VersionManagementService.activate(candidate._id, admin, {});
  assert.equal(activated.template.status, "active");
  const after = await USCISFormTemplate.find({ formCode: code }).lean();
  assert.deepEqual(after.map((item) => [item.version, item.status, item.activeFlag]).sort(), [["2024-04-01", "retired", false], ["2025-01-20", "active", true]]);

  // 4) running the check again changes nothing (idempotent)
  assert.equal((await service.runAutomaticCheck(code, "2025-01-20")).outcome, "unchanged");
  assert.equal(await FormEditionDecision.countDocuments({ formCode: code }), 1);
});

test("activation also needs a certification: an uncertified edition is refused even when USCIS accepts it, and nothing changes", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const live = await USCISFormTemplate.create(template(code, { version: "2024-04-01", editionDate: day("2024-04-01"), status: "active", activeFlag: true, currentStatus: "active" }));
  const candidate = await USCISFormTemplate.create(template(code, { importMetadata: { editionDateSource: "pdf" } })); // no certification on record
  const service = serviceFor(PAGE());
  setDepsForTests({ store: mongoStore, service, autoEvidence: false });
  assert.equal((await service.runAutomaticCheck(code, "2025-01-20")).outcome, "accepted");
  await assert.rejects(VersionManagementService.activate(candidate._id, admin, {}), (error) => error.status === 409 && /not been certified/.test(error.message));
  assert.equal((await USCISFormTemplate.findById(live._id).lean()).status, "active");
  assert.equal((await USCISFormTemplate.findById(candidate._id).lean()).status, "review");
});

test("a not_accepted edition is blocked for good on real models, and a later 'current' page cannot reverse it automatically", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  const candidate = await USCISFormTemplate.create(template(code));
  const refusing = `${PAGE()} USCIS will not accept the 01/20/25 edition of Form ${code}.`;
  const blockingService = serviceFor(refusing);
  setDepsForTests({ store: mongoStore, service: blockingService, autoEvidence: false });
  assert.equal((await blockingService.runAutomaticCheck(code, "2025-01-20")).outcome, "not_accepted");
  await assert.rejects(VersionManagementService.activate(candidate._id, admin, {}), (error) => error instanceof EditionPolicyHeldError && error.details.reasons.includes("not_accepted_by_uscis"));
  const friendly = serviceFor(PAGE());
  assert.equal((await friendly.runAutomaticCheck(code, "2025-01-20")).outcome, "locked_not_accepted");
  assert.equal((await FormEditionDecision.findOne({ formCode: code }).lean()).decision, "not_accepted");
});

test("two checks racing for the same edition leave exactly one decision row", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const code = newCode();
  await USCISFormTemplate.create(template(code));
  const results = await Promise.all([serviceFor(PAGE()).runAutomaticCheck(code, "2025-01-20"), serviceFor(PAGE()).runAutomaticCheck(code, "2025-01-20")]);
  assert.ok(results.every((result) => ["accepted", "unchanged"].includes(result.outcome)), JSON.stringify(results.map((result) => result.outcome)));
  assert.equal(await FormEditionDecision.countDocuments({ formCode: code }), 1);
});
