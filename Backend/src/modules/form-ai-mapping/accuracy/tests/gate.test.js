// The accuracy gate: open ONLY when every condition holds, closed (with every reason) otherwise, closed on any error; recordEvaluation is permanent. DB-free: injected stand-ins.
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiMappingGate, familyOf } = require("../AiMappingGate");
const { evaluate } = require("..");
const { build } = require("./fixtures");

const NOW = new Date("2026-10-22T12:00:00Z");
const DAY = 86400000;
const chain = (value) => ({ sort: () => ({ lean: async () => value }) });
const deps = (over = {}) => {
  const created = [];
  const state = {
    record: { met: true, expiresAt: new Date(NOW.getTime() + 10 * DAY), families: ["family", "single", "employment"], goldenChecksum: "golden-1", promptVersion: "3", model: "gemini-x", ...(over.record || {}) },
    signOff: over.signOff === undefined ? { entriesChecksum: "golden-1" } : over.signOff,
    draft: { entriesChecksum: "golden-1" },
    current: over.current || (() => ({ promptVersion: "3", model: "gemini-x" })),
  };
  return {
    state, created,
    deps: {
      Record: { findOne: () => { if (over.recordThrows) throw new Error("database down"); return chain(over.noRecord ? null : state.record); }, create: async (doc) => { created.push(doc); return { _id: "r1", ...doc }; } },
      SignOff: { findOne: () => chain(state.signOff) },
      draft: () => state.draft,
      current: state.current,
      now: () => NOW,
    },
  };
};
const gateFor = (over) => { const made = deps(over); return { ...made, gate: createAiMappingGate(made.deps) }; };

test("open only when every condition holds", async () => {
  const { gate } = gateFor();
  assert.deepEqual(await gate.isOpen({ formCode: "I-130" }), { open: true, reasons: [] });
  assert.deepEqual(await gate.isOpen({ formCode: "I-90", family: "single" }), { open: true, reasons: [] });
});

test("closed: no evaluation on record", async () => {
  const result = await gateFor({ noRecord: true }).gate.isOpen({ formCode: "I-130" });
  assert.equal(result.open, false);
  assert.ok(result.reasons.includes("no_evaluation_on_record"));
});

test("closed: the latest evaluation did not meet the criteria, or has expired", async () => {
  assert.ok((await gateFor({ record: { met: false } }).gate.isOpen({ formCode: "I-130" })).reasons.includes("evaluation_not_met"));
  assert.ok((await gateFor({ record: { expiresAt: new Date(NOW.getTime() - 1) } }).gate.isOpen({ formCode: "I-130" })).reasons.includes("evaluation_expired"));
});

test("closed: the golden set has no sign-off, lost it (changed since), or is not the key the evaluation used", async () => {
  assert.ok((await gateFor({ signOff: null }).gate.isOpen({ formCode: "I-130" })).reasons.includes("golden_set_not_signed_off"));
  assert.ok((await gateFor({ signOff: { entriesChecksum: "older" } }).gate.isOpen({ formCode: "I-130" })).reasons.includes("golden_set_changed_since_sign_off"));
  const result = await gateFor({ record: { goldenChecksum: "evaluated-against-another-key" } }).gate.isOpen({ formCode: "I-130" });
  assert.ok(result.reasons.includes("golden_set_changed_since_evaluation"));
  assert.equal(result.open, false);
});

test("closed: the prompt version or the model changed since the evaluation", async () => {
  assert.ok((await gateFor({ current: () => ({ promptVersion: "4", model: "gemini-x" }) }).gate.isOpen({ formCode: "I-130" })).reasons.includes("prompt_version_changed"));
  assert.ok((await gateFor({ current: () => ({ promptVersion: "3", model: "gemini-y" }) }).gate.isOpen({ formCode: "I-130" })).reasons.includes("model_changed"));
});

test("closed: what the engine uses now cannot be read (nothing exported, or it throws)", async () => {
  const none = await gateFor({ current: () => ({}) }).gate.isOpen({ formCode: "I-130" });
  assert.equal(none.open, false);
  assert.ok(none.reasons.includes("prompt_version_unreadable") && none.reasons.includes("model_unreadable"));
  const threw = await gateFor({ current: () => { throw new Error("boom"); } }).gate.isOpen({ formCode: "I-130" });
  assert.equal(threw.open, false);
  assert.ok(threw.reasons.includes("prompt_version_unreadable"));
});

test("closed: the form's family was never evaluated, or the form is not in the golden scope", async () => {
  assert.ok((await gateFor({ record: { families: ["employment", "single"] } }).gate.isOpen({ formCode: "I-130" })).reasons.includes("family_not_evaluated"));
  assert.ok((await gateFor().gate.isOpen({ formCode: "I-999" })).reasons.includes("form_not_in_golden_scope"));
  assert.equal(familyOf("i-130"), "family");
  assert.equal(familyOf("I-90"), "single");
  assert.equal(familyOf("NOPE"), null);
});

test("closed on ANY error, and every failing reason is reported together", async () => {
  const broken = await gateFor({ recordThrows: true }).gate.isOpen({ formCode: "I-130" });
  assert.deepEqual(broken, { open: false, reasons: ["gate_error"] });
  const many = await gateFor({ noRecord: true, signOff: null, current: () => ({}) }).gate.isOpen({ formCode: "I-130" });
  assert.ok(many.reasons.length >= 4);
  assert.equal(many.open, false);
});

test("recordEvaluation stores a permanent record with what produced it, and stamps an expiry", async () => {
  const { gate, created } = gateFor();
  const report = evaluate({ goldenDraft: build().draft, reviews: build().reviews, suggestionsByForm: build().suggestionsByForm });
  const row = await gate.recordEvaluation({ ...report, goldenChecksum: "golden-1" }, { by: "admin@immiglance.com", source: "live" });
  assert.equal(created.length, 1);
  assert.equal(row.met, true);
  assert.equal(created[0].promptVersion, "3");
  assert.equal(created[0].model, "gemini-x");
  assert.equal(created[0].goldenChecksum, "golden-1");
  assert.equal(created[0].source, "live");
  assert.equal(created[0].by, "admin@immiglance.com");
  assert.deepEqual(created[0].families.sort(), ["employment", "family", "single"]);
  assert.equal(created[0].expiresAt.getTime(), NOW.getTime() + 30 * DAY);
  assert.deepEqual(Object.keys(created[0].summary).sort(), ["autoUsedText", "blockers", "byFamily", "byKind", "overall", "precision", "results", "violationTotals"]);
});

test("recordEvaluation refuses what is not an accuracy report, and refuses when the engine's version cannot be read", async () => {
  await assert.rejects(gateFor().gate.recordEvaluation({}), /not an accuracy report/);
  await assert.rejects(gateFor({ current: () => ({}) }).gate.recordEvaluation({ met: true, goldenChecksum: "x" }), /could not be read/);
});

test("a record made from an evaluation that did not meet the criteria cannot open the gate", async () => {
  const bad = build();
  bad.entries.find((entry) => entry.boxKind === "text").technical.sourcePath = "petitioner.x"; // a correct key ...
  const report = evaluate({ goldenDraft: bad.draft, reviews: bad.reviews, suggestionsByForm: { ...bad.suggestionsByForm, E1: [] } }); // ... but an engine run that covers too little
  assert.equal(report.met, false);
  const { gate, created, state } = gateFor();
  await gate.recordEvaluation({ ...report, goldenChecksum: "golden-1" }, {});
  state.record = created[0];
  const result = await gate.isOpen({ formCode: "I-130" });
  assert.equal(result.open, false);
  assert.ok(result.reasons.includes("evaluation_not_met"));
});

test("status(): one answer per family and a plain summary of the newest evaluation; closed when nothing is on record; never throws", async () => {
  const open = await gateFor().gate.status();
  assert.equal(open.open, true);
  assert.deepEqual(Object.keys(open.families).sort(), ["employment", "family", "general", "single"]);
  assert.equal(open.latest.met, true);
  assert.equal(open.latest.model, "gemini-x");

  const none = await gateFor({ noRecord: true }).gate.status();
  assert.equal(none.open, false);
  assert.equal(none.latest, null);
  assert.ok(Object.values(none.families).every((family) => family.reasons.includes("no_evaluation_on_record")));

  const broken = await gateFor({ recordThrows: true }).gate.status();
  assert.equal(broken.open, false, "a database error reads as closed");
});
