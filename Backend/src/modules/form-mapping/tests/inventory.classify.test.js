// Phase 7.4: the pure per-field classification and the inventory build / summary / gate check. DB-free, no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyField, roleOf } = require("../inventory/classify");
const FieldInventory = require("../inventory/FieldInventory");

const field = (id, label, over = {}) => ({ fieldId: id, pdfFieldName: id, label, fieldType: "text", sectionTitle: "Part 1", pageNumber: 1, ...over });
const ctx = (over = {}) => ({ mappedIds: new Set(), pendingIds: new Set(), keptBlank: new Map(), formCode: "X-1", ...over });
const classOf = (f, c) => classifyField(f, c || ctx()).class;

test("an active edge makes a box mapped, whatever it is", () => {
  assert.equal(classOf(field("a", "Beneficiary Given Name"), ctx({ mappedIds: new Set(["a"]) })), "mapped");
  assert.equal(classOf(field("b", "Anything", { uscisUseOnly: true }), ctx({ mappedIds: new Set(["b"]) })), "mapped");
});

test("a box a person kept blank is deliberately_blank and says so (with the written reason when there is one)", () => {
  const keptBlank = new Map([["a", { targetFieldId: "a", reason: "USCIS says leave empty" }]]);
  const out = classifyField(field("a", "Beneficiary Middle Name"), ctx({ keptBlank }));
  assert.equal(out.class, "deliberately_blank");
  assert.match(out.reason, /a person decided/);
  assert.match(out.reason, /USCIS says leave empty/);
});

test("non-client-data boxes are non_data: USCIS-use-only, office use, signature, barcode, interpreter and preparer boxes, locked computed boxes", () => {
  assert.equal(classOf(field("a", "Beneficiary Name", { uscisUseOnly: true })), "non_data");
  assert.equal(classOf(field("b", "For USCIS Use Only - Action Block")), "non_data");
  assert.equal(classOf(field("c", "Signature of Petitioner", { fieldType: "signature" })), "non_data");
  assert.equal(classOf(field("d", "PDF417 BarCode", { fieldType: "text", pdfFieldName: "PDF417BarCode1[0]" })), "non_data");
  assert.equal(classOf(field("e", "Enter Interpreter's Given Name", { pdfFieldName: "Pt8Line1_InterpreterGivenName[0]" })), "non_data");
  assert.equal(classOf(field("f", "Preparer's Family Name", { pdfFieldName: "P7_Line1_PreparersFamilyName[0]" })), "non_data");
  assert.equal(classOf(field("g", "Total", { readOnly: true, calculated: true })), "non_data");
});

test("a box that speaks about a person with no active edge needs a source (protected role), with the role and the reason stated", () => {
  const out = classifyField(field("a", "Beneficiary's Date of Birth", { fieldType: "date" }), ctx());
  assert.equal(out.class, "unmapped_needs_source");
  assert.equal(out.protectedRole, true);
  assert.equal(out.role, "beneficiary");
  assert.match(out.reason, /speaks about the beneficiary/);
  assert.equal(classifyField(field("b", "Petitioner Company Name"), ctx()).role, "petitioner");
  assert.equal(classifyField(field("c", "Employer Telephone"), ctx()).role, "employer");
  assert.equal(classifyField(field("d", "Spouse of the Beneficiary"), ctx()).role, "dependent");
});

test("a box that names BOTH parties cannot be told apart: unclear role needs a source", () => {
  const out = classifyField(field("a", "Beneficiary and Petitioner relationship"), ctx());
  assert.equal(out.class, "unmapped_needs_source");
  assert.equal(out.roleUnknown, true);
  assert.equal(out.role, "unknown");
});

test("a required box with no mapping needs a source; a pending (needs_review) edge is not a mapping and is said so", () => {
  const required = classifyField(field("a", "Explain", { required: true }), ctx());
  assert.equal(required.class, "unmapped_needs_source");
  assert.match(required.reason, /required/);
  const pending = classifyField(field("b", "Beneficiary Given Name"), ctx({ pendingIds: new Set(["b"]) }));
  assert.equal(pending.class, "unmapped_needs_source");
  assert.match(pending.reason, /needs review/);
});

test("a conditional box is conditional, keeps its condition, and its required flag is carried", () => {
  const out = classifyField(field("a", "Beneficiary Other Name", { showWhen: { field: "x", operator: "equals", value: "yes" }, required: true }), ctx());
  assert.equal(out.class, "conditional");
  assert.equal(out.required, true);
  assert.deepEqual(out.condition, { field: "x", operator: "equals", value: "yes" });
});

test("an optional box with no party role, no condition and no source is deliberately_blank with the system's own stated reason", () => {
  const out = classifyField(field("a", "Additional remarks"), ctx());
  assert.equal(out.class, "deliberately_blank");
  assert.match(out.reason, /optional box with no party role/);
});

test("roleOf reuses the contract validator's party detection", () => {
  assert.equal(roleOf(field("a", "Applicant's Name")).party, "beneficiary");
  assert.equal(roleOf(field("b", "Sponsor Name")).party, "petitioner");
  assert.equal(roleOf(field("c", "Remarks")).party, null);
});

const graphOf = (...edges) => ({ edges: edges.map((id) => ({ targetFieldId: id, status: "active" })), keepBlank: [] });

test("build: every field gets exactly one class, the counts add up, and the gate holds on the boxes that need a source - never a percentage", () => {
  const fields = [
    field("a", "Beneficiary Given Name"), field("b", "Beneficiary Family Name"), field("c", "Petitioner Name"), field("s", "Signature", { fieldType: "signature" }),
    field("o", "Additional remarks"), field("u", "Office use", { uscisUseOnly: true }),
  ];
  const inventory = FieldInventory.build({ template: { formCode: "X-1" }, fields, graph: graphOf("a") });
  assert.equal(inventory.fields.length, 6);
  const total = Object.entries(inventory.counts).filter(([key]) => key !== "total").reduce((sum, [, value]) => sum + value, 0);
  assert.equal(total, inventory.counts.total);
  assert.deepEqual([inventory.counts.mapped, inventory.counts.unmapped_needs_source, inventory.counts.non_data, inventory.counts.deliberately_blank], [1, 2, 2, 1]);
  assert.equal(inventory.decision, "held");
  assert.deepEqual(inventory.hold.map((entry) => entry.id).sort(), ["b", "c"]);
  assert.equal(inventory.holdBy.protectedRole, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(inventory, "percent"), false);
});

test("build: a fully accounted-for form passes", () => {
  const fields = [field("a", "Beneficiary Given Name"), field("o", "Additional remarks"), field("s", "Signature", { fieldType: "signature" })];
  const inventory = FieldInventory.build({ template: {}, fields, graph: graphOf("a") });
  assert.equal(inventory.decision, "pass");
  assert.equal(inventory.hold.length, 0);
});

test("summarize: compact, capped, no field bodies; gateCheck: report mode never blocks and says what enforcement would do", () => {
  const many = Array.from({ length: 120 }, (_, i) => field(`n${i}`, `Beneficiary Box ${i}`));
  const inventory = FieldInventory.build({ template: { formCode: "X-1" }, fields: many, graph: graphOf() });
  const summary = FieldInventory.summarize(inventory);
  assert.equal(summary.hold.count, 120);
  assert.equal(summary.hold.fields.length, FieldInventory.CAP);
  assert.equal(JSON.stringify(summary).includes('"condition"'), false);
  const report = FieldInventory.gateCheck(summary, { mode: "report" });
  assert.deepEqual([report.outcome, report.wouldBe, report.report], ["pass", "held", true]);
  // owner decision 2026-10-23: the inventory never holds - a second argument asking for "enforce" is ignored
  const enforce = FieldInventory.gateCheck(summary, { mode: "enforce" });
  assert.deepEqual([enforce.outcome, enforce.wouldBe, enforce.report], ["pass", "held", true]);
  assert.equal(FieldInventory.gateCheck(null, { mode: "report" }).outcome, "pass");
  assert.equal(FieldInventory.gateCheck(null, { mode: "enforce" }).outcome, "pass"); // unknown is also just a note
});

test("gateMode: always report - FORM_INVENTORY_GATE=enforce is ignored (unmappable boxes are left blank, never a hold)", () => {
  assert.equal(FieldInventory.gateMode({}), "report");
  assert.equal(FieldInventory.gateMode({ FORM_INVENTORY_GATE: "ENFORCE" }), "report");
  assert.equal(FieldInventory.gateMode({ FORM_INVENTORY_GATE: "banana" }), "report");
});

test("conditionally-required boxes hold the gate; optional conditional boxes do not", () => {
  const required = FieldInventory.build({ template: {}, fields: [field("a", "Other name", { showWhen: { field: "x" }, required: true })], graph: graphOf() });
  assert.equal(required.decision, "held");
  assert.equal(required.holdBy.conditionalRequired, 1);
  const optional = FieldInventory.build({ template: {}, fields: [field("a", "Other name", { showWhen: { field: "x" } })], graph: graphOf() });
  assert.equal(optional.decision, "pass");
  assert.equal(optional.counts.conditional, 1);
});
