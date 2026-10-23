// DB-BACKED tests of the accuracy gate's record store, against the LOCAL test database only (src/test-utils/pipelineDb.js refuses anything else; with no local MongoDB the tests
// are skipped). Real AiMappingGateRecord (append-only) and GoldenSetSignOff models, the real gate. The Gemini API is never called. Everything these tests write is deleted afterwards.
const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const { useTestDatabase } = require("../../../../test-utils/pipelineDb");
const AiMappingGateRecord = require("../../../../models/AiMappingGateRecord");
const GoldenSetSignOff = require("../../../../models/GoldenSetSignOff");
const { createAiMappingGate } = require("../AiMappingGate");
const { evaluate } = require("..");
const { build } = require("./fixtures");

const MARK = "ZZ-PIPE-accuracy-test";
const raw = (name) => mongoose.connection.collection(name);
test.after(async () => {
  if (!db?.ok) return;
  // the record model refuses deletes by design: remove exactly this file's rows through the raw collection
  await raw(AiMappingGateRecord.collection.name).deleteMany({ by: MARK });
  await raw(GoldenSetSignOff.collection.name).deleteMany({ reviewerEmail: MARK });
});
const db = useTestDatabase({ before: test.before, after: test.after }, [AiMappingGateRecord, GoldenSetSignOff]);
const day = (offset) => new Date(Date.now() + offset * 86400000);
const record = (over = {}) => ({ met: true, by: MARK, promptVersion: "3", model: "gemini-x", goldenChecksum: "c1", families: ["employment", "family", "single"], forms: ["I-90"], expiresAt: day(30), ...over });
const gate = () => createAiMappingGate({ current: () => ({ promptVersion: "3", model: "gemini-x" }), draft: () => ({ entriesChecksum: "c1" }) });

test("the record store is append-only: a record cannot be changed or deleted, a newer one supersedes it", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const first = await AiMappingGateRecord.create(record({ met: false, evaluatedAt: day(-2) }));
  await assert.rejects(AiMappingGateRecord.updateOne({ _id: first._id }, { $set: { met: true } }), (error) => error.code === "APPEND_ONLY");
  await assert.rejects(AiMappingGateRecord.findOneAndUpdate({ _id: first._id }, { $set: { met: true } }), (error) => error.code === "APPEND_ONLY");
  await assert.rejects(AiMappingGateRecord.deleteMany({ _id: first._id }), (error) => error.code === "APPEND_ONLY");
  const reloaded = await AiMappingGateRecord.findById(first._id);
  reloaded.met = true;
  await assert.rejects(reloaded.save(), (error) => error.code === "APPEND_ONLY");
  assert.equal((await raw(AiMappingGateRecord.collection.name).findOne({ _id: first._id })).met, false, "nothing was changed");

  const newer = await AiMappingGateRecord.create(record({ met: true, evaluatedAt: day(-1) }));
  const latest = await gate().latest();
  assert.equal(String(latest._id), String(newer._id), "the newest record is the one that counts");
});

test("the real gate with real rows: open only while the golden sign-off matches, closed the moment it changes", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  await raw(AiMappingGateRecord.collection.name).deleteMany({ by: MARK });
  await AiMappingGateRecord.create(record({ evaluatedAt: day(-1) }));
  const noSignOff = await gate().isOpen({ formCode: "I-130" });
  assert.equal(noSignOff.open, false);
  assert.ok(noSignOff.reasons.includes("golden_set_not_signed_off") || noSignOff.reasons.includes("golden_set_changed_since_sign_off"), "a sign-off is required");

  await GoldenSetSignOff.create({ reviewerEmail: MARK, entriesChecksum: "c1", signedAt: day(-1) });
  assert.deepEqual(await gate().isOpen({ formCode: "I-130" }), { open: true, reasons: [] });

  await GoldenSetSignOff.create({ reviewerEmail: MARK, entriesChecksum: "c2-the-set-changed", signedAt: day(0) });
  const changed = await gate().isOpen({ formCode: "I-130" });
  assert.equal(changed.open, false);
  assert.ok(changed.reasons.includes("golden_set_changed_since_sign_off"));
});

test("a stored evaluation that did not meet the criteria, or has expired, keeps the real gate closed", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  await GoldenSetSignOff.create({ reviewerEmail: MARK, entriesChecksum: "c1", signedAt: day(1) });
  await AiMappingGateRecord.create(record({ met: false, evaluatedAt: day(0.1) }));
  assert.ok((await gate().isOpen({ formCode: "I-130" })).reasons.includes("evaluation_not_met"));
  await AiMappingGateRecord.create(record({ met: true, evaluatedAt: day(0.2), expiresAt: day(-1) }));
  assert.ok((await gate().isOpen({ formCode: "I-130" })).reasons.includes("evaluation_expired"));
});

test("recordEvaluation writes a real record from a real evaluation, and a failed evaluation is recorded as failed", async (t) => {
  if (!db.ok) return t.skip(db.reason);
  const scenario = build();
  const report = evaluate({ goldenDraft: scenario.draft, reviews: scenario.reviews, suggestionsByForm: scenario.suggestionsByForm });
  const real = createAiMappingGate({ current: () => ({ promptVersion: "7", model: "gemini-x" }) });
  const stored = await real.recordEvaluation(report, { by: MARK, source: "manual" });
  const row = await raw(AiMappingGateRecord.collection.name).findOne({ _id: stored._id });
  assert.equal(row.met, true);
  assert.equal(row.promptVersion, "7");
  assert.equal(row.goldenChecksum, "golden-checksum-1");
  assert.equal(row.source, "manual");
  assert.ok(row.expiresAt > new Date());
  const failedScenario = build();
  failedScenario.suggestionsByForm.E1[0].candidate.path = "beneficiary.x";
  const failedReport = evaluate({ goldenDraft: failedScenario.draft, reviews: failedScenario.reviews, suggestionsByForm: failedScenario.suggestionsByForm });
  const storedFailed = await real.recordEvaluation(failedReport, { by: MARK });
  assert.equal((await raw(AiMappingGateRecord.collection.name).findOne({ _id: storedFailed._id })).met, false);
});
