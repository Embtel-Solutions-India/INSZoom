const test = require("node:test");
const assert = require("node:assert/strict");

const { VISA_CATEGORIES, getCaseStructure } = require("../../../config/visaCategories");
const { defaultEntries, resolveVisa, validateEntries, extractFieldValues, FIELD_NAMES, FIELD_KEYS } = require("../ghlVisaMapping");
const { fetchFieldIds, ensureFieldIds } = require("../ghlCustomFieldService");
const { planFromResolution } = require("../ghlVisaService");

// ---- fixtures ---------------------------------------------------------------

const IDS = { service_type: "ST", work_visa: "WV", study_visa: "SV", green_card: "GC", business__investment: "BI" };
const fields = (obj) => Object.entries(obj).map(([name, value]) => ({ id: IDS[name], type: "string", fieldValueString: value }));
const entries = defaultEntries();
const resolve = (obj, pipelineCategory, extra = {}) => resolveVisa({ customFields: fields(obj), fieldIds: IDS, entries, pipelineCategory, ...extra });

// ---- the seed table is trustworthy -------------------------------------------

test("every seeded mapping points at a REAL visa type with the right category", () => {
  for (const e of entries) {
    assert.ok(VISA_CATEGORIES[e.visaType], `${e.field}="${e.value}" -> unknown visa "${e.visaType}"`);
    assert.equal(e.category, e.visaType.startsWith("EB-") ? "immigrant" : "non_immigrant", `${e.visaType} category`);
    assert.ok(FIELD_NAMES.includes(e.field));
  }
  assert.equal(validateEntries(entries).ok, true);
});

test("ambiguous GHL options are deliberately NOT mapped (no guessing)", () => {
  const values = entries.map((e) => e.value);
  for (const guess of ["P-1 - Athletes & Entertainers", "CPT", "Day 1 CPT", "EB-5 - Investor Green Card", "I-130 - Family Green Card Petition"]) {
    assert.ok(!values.includes(guess), `${guess} must stay unmapped`);
  }
});

// ---- resolveVisa --------------------------------------------------------------

test("a single-party detail value maps to its visa, structure and category", () => {
  const r = resolve({ service_type: "Study Visa", study_visa: "F-1 - Academic Student" }, "non_immigrant");
  assert.equal(r.status, "mapped");
  assert.deepEqual([r.visaType, r.structure, r.category, r.categoryMismatch], ["F-1", "single", "non_immigrant", false]);
});

test("matching ignores case and extra spaces", () => {
  assert.equal(resolve({ study_visa: "  stem   opt " }).visaType, "F-1 STEM OPT");
});

test("an employer visa is mapped but reported as employer_employee", () => {
  const r = resolve({ service_type: "Work Visa", work_visa: "L-1A" }, "non_immigrant");
  assert.equal(r.status, "mapped");
  assert.equal(r.structure, "employer_employee");
});

test("a visa that needs a sub-type (H-1B) is incomplete, not guessed", () => {
  const r = resolve({ service_type: "Work Visa", work_visa: "H-1B - Specialty Occupation" });
  assert.equal(r.status, "incomplete");
  assert.match(r.reason, /sub-type/);
  assert.equal(r.visaType, "H-1B");
});

test("a category-only Service Type is incomplete", () => {
  assert.equal(resolve({ service_type: "Work Visa" }).status, "incomplete");
});

test("an unknown GHL value is unmapped and says which one", () => {
  const r = resolve({ service_type: "Study Visa", study_visa: "CPT" });
  assert.equal(r.status, "unmapped");
  assert.match(r.reason, /CPT/);
});

test("two filled detail fields, or a contradiction with Service Type, are ambiguous", () => {
  assert.equal(resolve({ work_visa: "L-1A", study_visa: "J-1 - Exchange Visitor" }).status, "ambiguous");
  assert.equal(resolve({ service_type: "Study Visa", work_visa: "L-1A" }).status, "ambiguous");
});

test("nothing filled in is 'none'; unknown field definitions are 'unavailable'", () => {
  assert.equal(resolve({}).status, "none");
  assert.equal(resolveVisa({ customFields: fields({ work_visa: "L-1A" }), fieldIds: null, entries }).status, "unavailable");
  assert.equal(resolveVisa({ customFields: [], fieldIds: {}, entries }).status, "unavailable");
});

test("a pipeline/visa category disagreement is reported but the visa still resolves", () => {
  const r = resolve({ study_visa: "F-1 - Academic Student" }, "immigrant");
  assert.equal(r.status, "mapped");
  assert.equal(r.categoryMismatch, true);
});

test("FUTURE detailed Service Type values work by adding a row, with no code change", () => {
  const future = [...entries, { field: "service_type", value: "H-1B New", visaType: "H-1B", petitionSubType: "New H-1B", category: "non_immigrant" }, { field: "service_type", value: "H-1B Extension", visaType: "H-1B", petitionSubType: "H-1B Extension", category: "non_immigrant" }];
  const r = resolveVisa({ customFields: fields({ service_type: "H-1B New" }), fieldIds: IDS, entries: future });
  assert.equal(r.status, "mapped");
  assert.deepEqual([r.visaType, r.petitionSubType, r.structure], ["H-1B", "New H-1B", "employer_employee"]);
  assert.equal(resolveVisa({ customFields: fields({ service_type: "H-1B Extension" }), fieldIds: IDS, entries: future }).petitionSubType, "H-1B Extension");
});

test("field values are read from every shape GHL uses", () => {
  const ids = { work_visa: "WV" };
  assert.equal(extractFieldValues([{ id: "WV", fieldValueString: "L-1A" }], ids).work_visa, "L-1A");
  assert.equal(extractFieldValues([{ id: "WV", fieldValue: "TN - NAFTA Professionals" }], ids).work_visa, "TN - NAFTA Professionals");
  assert.equal(extractFieldValues([{ id: "WV", value: ["O-1A"] }], ids).work_visa, "O-1A");
  assert.deepEqual(extractFieldValues(undefined, ids), {});
  assert.deepEqual(extractFieldValues([{ id: "OTHER", fieldValueString: "x" }], ids), {});
});

// ---- admin validation ----------------------------------------------------------

test("an admin mapping is validated: real visa, real sub-type, known field, no duplicates", () => {
  const good = { field: "service_type", value: "H-1B New", visaType: "H-1B", petitionSubType: "New H-1B", category: "non_immigrant" };
  assert.equal(validateEntries([good]).ok, true);
  const bad = validateEntries([
    { ...good, value: "r1", visaType: "NOT-A-VISA" },
    { ...good, value: "r2", petitionSubType: "Nonsense" },
    { ...good, value: "r3", field: "mystery" },
    { ...good, value: "" },
    { ...good, value: "r5", category: "sideways" },
  ]);
  assert.equal(bad.ok, false);
  assert.equal(bad.errors.length, 5);
  assert.deepEqual(bad.entries, []); // nothing is accepted unless every row is valid
  assert.equal(validateEntries([good, { ...good, value: " h-1b   new " }]).ok, false); // duplicate after normalising
  assert.equal(validateEntries("nope").ok, false);
});

// ---- what happens with a resolution --------------------------------------------

test("only a MAPPED SINGLE-party visa is applied; employer visas are a suggestion plus a flag", () => {
  const applied = planFromResolution(resolve({ study_visa: "J-1 - Exchange Visitor" }, "non_immigrant"));
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.fields, { visaType: "J-1", visaCategory: "J-1", petitionType: "J-1", visaSelectionStatus: "selected" });
  assert.equal(applied.record.status, "applied");
  assert.deepEqual(applied.attention, []);

  const employer = planFromResolution(resolve({ work_visa: "L-1A" }, "non_immigrant"));
  assert.equal(employer.applied, false);
  assert.deepEqual(employer.fields, {}); // nothing visa-driven is touched
  assert.equal(employer.record.status, "structure_unsupported");
  assert.match(employer.attention[0], /L-1A/);

  const mismatch = planFromResolution(resolve({ study_visa: "F-1 - Academic Student" }, "immigrant"));
  assert.equal(mismatch.applied, true);
  assert.equal(mismatch.attention.length, 1);

  assert.equal(planFromResolution(resolve({ work_visa: "L-1A", study_visa: "J-1 - Exchange Visitor" })).attention.length, 1); // ambiguous
  assert.deepEqual(planFromResolution(resolve({ service_type: "Work Visa" })).attention, []); // merely incomplete: no flag, "Visa required" already shows
  assert.deepEqual(planFromResolution(null), { applied: false, fields: {}, record: null, attention: [] });
});

// ---- custom field lookup -------------------------------------------------------

test("field ids are looked up by stable fieldKey, and a refusal never throws", async () => {
  const defs = FIELD_NAMES.map((n) => ({ id: `id-${n}`, fieldKey: FIELD_KEYS[n], name: n }));
  const ok = await fetchFieldIds({ client: { get: async () => ({ customFields: [...defs, { id: "x", fieldKey: "opportunity.other" }] }) }, locationId: "L" });
  assert.equal(ok.ids.work_visa, "id-work_visa");
  assert.equal(Object.keys(ok.ids).length, 5);

  const refused = await fetchFieldIds({ client: { get: async () => { throw Object.assign(new Error("scope"), { status: 401 }); } }, locationId: "L" });
  assert.equal(refused.ids, null);
  assert.equal(refused.status, 401);
});

test("field ids are resolved ONCE per config (a bulk import must not call GHL per opportunity), failures too", async () => {
  let calls = 0;
  const client = { get: async () => { calls += 1; return { customFields: FIELD_NAMES.map((n) => ({ id: `i-${n}`, fieldKey: FIELD_KEYS[n] })) }; } };
  const config = { locationId: "L", visaMapping: {} };
  for (let i = 0; i < 25; i += 1) await ensureFieldIds(config, { client });
  assert.equal(calls, 1);

  let refusals = 0;
  const refusing = { get: async () => { refusals += 1; throw Object.assign(new Error("scope"), { status: 401 }); } };
  const config2 = { locationId: "L", visaMapping: {} };
  for (let i = 0; i < 25; i += 1) assert.equal(await ensureFieldIds(config2, { client: refusing }), null);
  assert.equal(refusals, 1);
});

test("a visa that exists in the mapping but not in the app is treated as unmapped, never applied", () => {
  const broken = [{ field: "work_visa", value: "L-1A", visaType: "GONE-VISA", petitionSubType: "", category: "non_immigrant" }];
  const r = resolveVisa({ customFields: fields({ work_visa: "L-1A" }), fieldIds: IDS, entries: broken });
  assert.equal(r.status, "unmapped");
  assert.equal(getCaseStructure("GONE-VISA"), null);
  assert.equal(planFromResolution(r).applied, false);
});
