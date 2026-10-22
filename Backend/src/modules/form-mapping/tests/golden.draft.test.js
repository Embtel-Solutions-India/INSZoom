// DB-free tests for the golden-set draft: plain-language wording, sample client values, selection and the plan's bar.
const test = require("node:test");
const assert = require("node:assert/strict");
const humanize = require("../golden/humanize");
const { sampleValue, buildSampleCanonical, valuesThatSatisfy } = require("../golden/sampleClient");
const { buildDraft, dedupe, selectForForm, toEntry, SCOPE, HELD_OUT_FORMS } = require("../golden/buildDraft");
const { toCsv } = require("../golden/exportCsv");

const TECHNICAL = /[a-z]+[A-Z][a-z]+\.|\bform\d|part\d+line|Subform|\[\d\]|\b(petitioner|beneficiary|person|case|raw)\.[a-z]|\.value/;
let counter = 0;
const edge = (over = {}) => ({ mappingId: "m", targetFieldId: `f${counter += 1}`, targetPdfField: "form1[0].Pt1Line3_GivenName[0]", targetLabel: "Item 3: Enter Given Name (First Name)", targetType: "text", section: "Part 1", pageNumber: 2, sourcePath: "beneficiary.firstName", status: "active", ...over });

test("petitioner is the employer on employment forms and the sponsor on family forms", () => {
  assert.equal(humanize.describePath("petitioner.name", "employment"), "the employer's name");
  assert.equal(humanize.describePath("petitioner.firstName", "family"), "the sponsor's first (given) name");
  assert.equal(humanize.partyOfPath("beneficiary.dob", "family"), "Relative (beneficiary)");
});

test("technical paths never leak into wording", () => {
  const paths = ["petitioner.signatory.firstName", "beneficiary.usMailingAddress.line1", "employment.offSiteWorkLocations[1].city", "raw.questionnaireAnswers.petitioner_residential_history.value.1.province_state.value", "case.visaType"];
  for (const path of paths) assert.doesNotMatch(humanize.describePath(path, "employment"), TECHNICAL, path);
  assert.equal(humanize.describePath("raw.questionnaireAnswers.petitioner_residential_history.value.1.province_state.value"), 'the client\'s answer to the question "petitioner residential history province state"');
});

test("labels and locations read like the printed form", () => {
  assert.equal(humanize.cleanLabel("Item 3: Enter Given Name (First Name)"), "Given Name (First Name)");
  assert.equal(humanize.whereOnForm({ section: "Part 2", targetLabel: "Item 14. Street", pageNumber: 3 }), "Part 2, Item 14, page 3");
});

test("conditions and transforms are sentences", () => {
  assert.equal(humanize.describeCondition({ field: "case.visaType", operator: "in", value: ["K-1", "K1", "k-1"] }, "family"), "the case's visa type is one of K-1");
  assert.match(humanize.describeTransform({ type: "phone" }), /phone number/);
});

test("sample client: answers fit the question; parties differ; the visa depends on the family; conditions can be satisfied", () => {
  assert.equal(sampleValue("raw.questionnaireAnswers.employer_company_address_zip_code.value"), "95113");
  assert.equal(sampleValue("raw.questionnaireAnswers.beneficiary_email.value"), "sample.client@example.com");
  assert.equal(sampleValue("beneficiary.firstName"), "Maria");
  assert.equal(sampleValue("petitioner.signatory.firstName"), "Daniel");
  assert.equal(buildSampleCanonical(["beneficiary.firstName"], { family: "family" }).case.visaType, "IR-1");
  assert.deepEqual(valuesThatSatisfy({ any: [{ field: "case.filingBasis", operator: "equals", value: "extension" }, { field: "x.y", operator: "equals", value: "z" }] }), { "case.filingBasis": "extension" });
});

test("repeated boxes are reviewed once and say how often they appear", () => {
  const merged = dedupe([edge(), edge(), edge({ sourcePath: "beneficiary.lastName", targetLabel: "Family Name" })]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find((e) => e.sourcePath === "beneficiary.firstName").__appears, 2);
});

test("selection keeps every kind of box when capped", () => {
  const edges = [
    ...Array.from({ length: 30 }, (_, i) => edge({ targetLabel: `Text ${i}`, pageNumber: 1 })),
    edge({ targetType: "date", targetLabel: "Date" }), edge({ targetType: "checkbox", targetLabel: "Box" }), edge({ targetType: "dropdown", targetLabel: "List" }),
  ];
  const kinds = new Set(selectForForm(edges, 10).map((e) => humanize.widgetKind(e.targetType)));
  assert.deepEqual([...kinds].sort(), ["checkbox", "date", "dropdown", "text"]);
});

test("an entry shows what the real autofill would put in the box, in plain words", () => {
  const entry = toEntry(edge({ sourcePath: "beneficiary.dob", targetLabel: "Date of Birth", targetType: "date", transform: { type: "date" } }), "I-130", 1);
  assert.match(entry.example.boxShows, /1990/);
  assert.equal(entry.belongsTo, "Relative (beneficiary)");
  assert.doesNotMatch(entry.sentence, TECHNICAL);
  assert.equal(entry.technical.sourcePath, "beneficiary.dob");
});

test("a conditional box is shown for a client where the condition applies", () => {
  const entry = toEntry(edge({ sourcePath: "beneficiary.firstName", condition: { field: "case.filingBasis", operator: "equals", value: "extension" } }), "I-129", 1);
  assert.match(entry.example.boxShows, /Maria.*where this applies/);
  assert.match(entry.onlyWhen, /extension/);
});

test("inactive edges are left out; the held-out form is flagged; ids and checksum are stable", () => {
  const graphs = { "I-131": [edge({ targetFieldId: "x1" }), edge({ targetFieldId: "x2", status: "pending", sourcePath: "beneficiary.lastName", targetLabel: "Family" })], "I-130": [edge({ targetFieldId: "y1" })], "I-90": [edge({ targetFieldId: "z1" })] };
  const first = buildDraft(graphs);
  const second = buildDraft(graphs);
  assert.deepEqual(first.entries.map((e) => e.formCode).sort(), ["I-130", "I-131", "I-90"]);
  assert.equal(first.entries.find((e) => e.formCode === "I-90").heldOut, true);
  assert.equal(first.entries.find((e) => e.formCode === "I-131").heldOut, false, "I-131 has its own rules now, so it is no longer held out");
  assert.equal(first.entriesChecksum, second.entriesChecksum);
  assert.ok(HELD_OUT_FORMS.every((code) => SCOPE[code]));
  assert.equal(first.meetsPlan.ok, false);
});

test("CSV carries only plain wording and the reviewer's columns", () => {
  const csv = toCsv(buildDraft({ "I-130": [edge({ targetLabel: 'Name, "quoted"' })] }).entries);
  assert.equal(csv.split("\r\n").length, 2);
  assert.match(csv, /Your answer/);
  assert.doesNotMatch(csv, /targetFieldId|Pt1Line3|sourcePath/);
});

test("the committed draft meets the plan's bar and shows no technical wording", () => {
  const draft = require("../golden/goldenSet.draft.json");
  assert.equal(draft.meetsPlan.ok, true, JSON.stringify(draft.meetsPlan.results));
  assert.ok(draft.summary.total >= 300);
  const technical = draft.entries.filter((e) => TECHNICAL.test([e.boxLabel, e.fillsWith, e.writtenAs, e.onlyWhen, e.ifEmpty, e.sentence, e.where, e.example.boxShows].join(" ")));
  assert.equal(technical.length, 0, technical.slice(0, 3).map((e) => e.sentence).join("\n"));
  assert.equal(new Set(draft.entries.map((e) => e.id)).size, draft.entries.length);
});
