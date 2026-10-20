// Generic party mapping: the rewire of a form's raw question-key edges to petitioner.* / beneficiary.* must change WHICH path a box reads, never WHAT it fills.
// Pure tests need nothing; the form tests read real templates and graphs from the local isolated test database (test-utils/db.js) and write nothing.
const test = require("node:test");
const assert = require("node:assert/strict");

const { planRewire, planRollback, genericPathFor, loadBaseGraph } = require("../services/ChecklistPartyRewireService");
const { CHECKLIST_PARTY_PATHS, QUESTION_PATH_INDEX } = require("../../canonical/config/partyChecklistPaths");

// ── pure ────────────────────────────────────────────────────────────────────
const edge = (targetFieldId, sourcePath, extra = {}) => ({ mappingId: `m:${targetFieldId}`, targetFieldId, sourcePath, status: "active", ...extra });

test("an edge that reads a listed question reads the generic path instead, and keeps the old key as its fallback", () => {
  const graph = { nodes: { canonical: [] }, edges: [edge("a", "raw.questionnaireAnswers.employer_company_address_city.value"), edge("b", "raw.questionnaireAnswers.some_other_checklist_key.value"), edge("c", "person.lastName")] };
  const { graph: next, report } = planRewire(graph);
  const byId = Object.fromEntries(next.edges.map((item) => [item.targetFieldId, item]));
  assert.equal(byId.a.sourcePath, "petitioner.address.city");
  assert.equal(byId.a.fallback, "raw.questionnaireAnswers.employer_company_address_city.value");
  assert.equal(byId.b.sourcePath, "raw.questionnaireAnswers.some_other_checklist_key.value", "an unlisted question is left exactly as it is");
  assert.equal(byId.c.sourcePath, "person.lastName");
  assert.equal(report.rewired, 1);
  assert.equal(graph.edges[0].sourcePath.startsWith("raw."), true, "the input graph is never mutated");
  assert.ok(next.nodes.canonical.some((node) => node.path === "petitioner.address.city"));
});

test("a row of a repeating group keeps its row path, conditions and transforms are rewired too, an existing fallback is kept, and a second run changes nothing", () => {
  const graph = { nodes: {}, edges: [
    edge("row", "raw.questionnaireAnswers.petitioner_employmentHistory.value.0.employerName"),
    edge("yes", "raw.questionnaireAnswers.employee_immigrationHistory_inRemovalProceedings.value", { condition: { field: "raw.questionnaireAnswers.employee_filingType.value", operator: "equals", value: "Change of employer" }, fallback: "legacy.path" }),
    edge("combo", "x.y", { transform: { type: "concat", fields: ["raw.questionnaireAnswers.employee_personal_firstName.value", "raw.questionnaireAnswers.employee_personal_lastName.value"] } }),
  ] };
  const first = planRewire(graph).graph;
  const byId = Object.fromEntries(first.edges.map((item) => [item.targetFieldId, item]));
  assert.equal(byId.row.sourcePath, "petitioner.employmentHistory.0.employerName");
  assert.equal(byId.yes.sourcePath, "beneficiary.anyPersonInRemovalProceedings");
  assert.equal(byId.yes.fallback, "legacy.path", "an existing fallback is not replaced");
  // the condition accepts the generic path OR the old key (positive test), so neither kind of profile is skipped
  assert.deepEqual(byId.yes.condition, { any: [{ field: "petitioner.petition.filingType", operator: "equals", value: "Change of employer" }, { field: "raw.questionnaireAnswers.employee_filingType.value", operator: "equals", value: "Change of employer" }] });
  assert.deepEqual(byId.combo.transform.fields, ["beneficiary.firstName", "beneficiary.lastName"]);
  const second = planRewire(first);
  assert.equal(second.report.rewired, 0);
  assert.deepEqual(second.graph.edges, first.edges, "idempotent");
});

test("an edge an earlier pass wired by PDF field name keeps working: the question's own path becomes primary and the earlier path its fallback", () => {
  const graph = { nodes: {}, edges: [
    edge("physical", "petitioner.address.line1", { fallback: "raw.questionnaireAnswers.i907_physical_address_street.value" }),
    edge("mailing", "petitioner.address.line1", { fallback: "raw.questionnaireAnswers.i907_mailing_address_street.value" }),
    edge("filer", "petitioner.signatory.firstName", { fallback: "raw.questionnaireAnswers.i907_filer_first_name.value" }),
  ] };
  const { graph: next, report } = planRewire(graph);
  const byId = Object.fromEntries(next.edges.map((item) => [item.targetFieldId, item]));
  assert.equal(byId.physical.sourcePath, "petitioner.physicalAddress.line1", "the physical box reads the physical address, not the mailing one");
  assert.equal(byId.physical.fallback, "petitioner.address.line1", "what it read before still fills it when no physical address was given");
  assert.equal(byId.mailing.sourcePath, "petitioner.address.line1");
  assert.equal(byId.filer.sourcePath, "petitioner.signatory.firstName");
  assert.equal(report.retargeted, 1, "only the physical box changed what it reads");
  // the point of contact is its own person: its box reads petitioner.pointOfContact.* and still falls back to the signatory it read before
  const contact = planRewire({ nodes: {}, edges: [edge("poc", "petitioner.signatory.firstName", { fallback: "raw.questionnaireAnswers.i907_company_poc_first_name.value" })] });
  assert.equal(contact.graph.edges[0].sourcePath, "petitioner.pointOfContact.firstName");
  assert.equal(contact.graph.edges[0].fallback, "petitioner.signatory.firstName");
  assert.equal(planRollback(next).graph.edges[0].sourcePath, "petitioner.address.line1");
  // a second run changes nothing - not even an edge whose kept fallback is a DIFFERENT question (an old edge with a first-name fallback must not be swapped)
  const again = planRewire(next);
  assert.equal(again.report.rewired + again.report.retargeted + again.report.conditionsRewired, 0);
  assert.deepEqual(again.graph.edges, next.edges);
  const kept = planRewire({ nodes: {}, edges: [edge("odd", "raw.questionnaireAnswers.petitioner_parents_fatherLastName.value", { fallback: "raw.questionnaireAnswers.petitioner_parents_fatherFirstName.value" })] });
  assert.equal(kept.graph.edges[0].sourcePath, "petitioner.father.lastName");
  assert.equal(planRewire(kept.graph).report.retargeted, 0);
  assert.equal(planRewire(kept.graph).graph.edges[0].sourcePath, "petitioner.father.lastName");
});

test("rollback puts every rewired edge back exactly as it was and leaves untouched edges alone", () => {
  const original = { nodes: {}, edges: [
    edge("a", "raw.questionnaireAnswers.employer_company_address_city.value", { profileOwner: "employer", transform: { type: "direct" } }),
    edge("b", "raw.questionnaireAnswers.employee_filingType.value", { condition: { field: "raw.questionnaireAnswers.employee_filingType.value", operator: "equals", value: "New H1B" }, partyRule: "old.rule", fallback: "keep.me" }),
    edge("c", "person.lastName"),
  ] };
  const rewired = planRewire(original).graph;
  assert.notDeepEqual(rewired.edges[0], original.edges[0]);
  const back = planRollback(rewired);
  assert.equal(back.report.restored, 2);
  assert.deepEqual(back.graph.edges, original.edges);
  assert.equal(planRollback(back.graph).report.restored, 0, "a second rollback changes nothing");
});

test("a negative condition must hold for both paths; a positive one for either", () => {
  const graph = { nodes: {}, edges: [edge("neg", "x.y", { condition: { field: "raw.questionnaireAnswers.employee_filingType.value", operator: "empty" } }), edge("pos", "x.y", { condition: { field: "raw.questionnaireAnswers.employee_filingType.value", operator: "exists", value: true } })] };
  const byId = Object.fromEntries(planRewire(graph).graph.edges.map((item) => [item.targetFieldId, item]));
  assert.equal(Object.keys(byId.neg.condition)[0], "all");
  assert.equal(Object.keys(byId.pos.condition)[0], "any");
});

test("the table is consistent: only petitioner.* / beneficiary.* paths, no form- or visa-named namespace, no two questions of one checklist on one path", () => {
  for (const [checklistKey, questions] of Object.entries(CHECKLIST_PARTY_PATHS)) {
    const seen = new Map();
    for (const [questionKey, spec] of Object.entries(questions)) {
      assert.match(spec.path, /^(petitioner|beneficiary)\./, `${checklistKey}.${questionKey} -> ${spec.path}`);
      assert.doesNotMatch(spec.path, /^(petitioner|beneficiary)\.(i\d{2,3}[a-z]?|h1b|h4|perm|o1[ab]?|k1|k3|ir1|premiumProcessing|requestFiler)(\.|$)/i, `${spec.path} is named after a form / visa`);
      // one person answers two questions of Form I-907 (the filer and the petitioner-or-applicant): the same fact, on purpose (the point of contact is a separate person)
      const SHARED_BY_DESIGN = new Set(["petitioner.signatory.lastName", "petitioner.signatory.firstName"]);
      if (seen.has(spec.path) && !SHARED_BY_DESIGN.has(spec.path)) assert.fail(`${checklistKey}: ${questionKey} and ${seen.get(spec.path)} both write ${spec.path}`);
      seen.set(spec.path, questionKey);
    }
  }
  assert.equal(genericPathFor("raw.questionnaireAnswers.employer_company_fein.value"), "petitioner.ein");
  assert.equal(genericPathFor("company.name"), null);
  assert.ok(QUESTION_PATH_INDEX.size > 150);
});

test("a question key means one fact: wherever two checklists share a key they give it the same path; the single-address answers are split into parts", () => {
  const byKey = new Map();
  for (const [checklistKey, questions] of Object.entries(CHECKLIST_PARTY_PATHS)) {
    for (const [questionKey, spec] of Object.entries(questions)) {
      if (byKey.has(questionKey)) assert.equal(byKey.get(questionKey), spec.path, `${questionKey} (${checklistKey}) has another path in a different checklist`);
      byKey.set(questionKey, spec.path);
    }
  }
  // 24 checklists of batches 1-3 + the 37 that repeat one of them; the contact / joint sponsor are kept under the petitioner, never a third root
  assert.equal(Object.keys(CHECKLIST_PARTY_PATHS).length, 125, "24 + 37 repeats + 64 others (PERM and the documents-only checklist are left out)");
  assert.equal(CHECKLIST_PARTY_PATHS.i130_f2b_beneficiary_checklist.beneficiary_lastName.path, CHECKLIST_PARTY_PATHS.i130_ir1_beneficiary_checklist.beneficiary_lastName.path, "a repeated checklist gives its questions the same paths");
  assert.ok([...byKey.values()].every((path) => /^(petitioner|beneficiary)\./.test(path)));
  const PartyAliasService = require("../../canonical/services/PartyAliasService");
  const profile = PartyAliasService.apply({ case: { caseStructure: "employer_employee" }, petitioner: { address: { formatted: "100 Main St, Flagstaff, AZ 86001" } }, beneficiary: { currentAddress: { formatted: "5 Oak Ave, Tempe, AZ 85281" } } });
  assert.equal(profile.company.address.formatted, "100 Main St, Flagstaff, AZ 86001", "the old shared path still receives the one-line address");
  assert.equal(profile.petitioner.address.city, "Flagstaff");
  assert.equal(profile.beneficiary.city, "Tempe");
});

// ── real forms (local test database, read only) ─────────────────────────────
const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const MappingGraphService = require("../services/MappingGraphService");
const FormMappingService = require("../services/FormMappingService");
const MappingResolver = require("../services/MappingResolver");
const { employerAnswers, employeeAnswers } = require("../../../test-utils/fixtures/h1b-golden");

const RAW = /^raw\.questionnaireAnswers\.([^.]+)\.value(.*)$/;
const setDeep = (target, path, value) => MappingResolver.setPath(target, path, value);

// A believable answer for a question, by what it is asked for (enough for the transforms to produce a value; A, B and C all get the same one)
function sampleValue(questionKey, restPaths) {
  if (restPaths.size) { const row = {}; restPaths.forEach((rest) => { const name = rest.split(".").pop(); row[name] = /date|from|to$/i.test(name) ? "2020-03-04" : `${name}-value`; }); return [row, { ...row }]; }
  if (/date|expiration|arrival/i.test(questionKey)) return "2025-10-01";
  if (/phone|fax/i.test(questionKey)) return "5205551234";
  if (/email/i.test(questionKey)) return "x@example.com";
  if (/ssn|socialSecurity/i.test(questionKey)) return "123-45-6789";
  if (/zip|postal/i.test(questionKey)) return "86301";
  if (/state/i.test(questionKey)) return "AZ";
  if (/country/i.test(questionKey)) return "India";
  if (/hasValidPassport|inRemoval|FiledGreenCard|heldH1b|deniedH1b|isH1b|isAcwia|sameAsPhysical|firstLca|dolVerified|replaceI94/i.test(questionKey)) return "Yes";
  if (/salary|income|netIncome|wage(?!Level)/i.test(questionKey)) return "63000";
  if (/filingType/i.test(questionKey)) return "Change of employer";
  if (/filingCapType/i.test(questionKey)) return "Regular CAP";
  if (/highestLevel/i.test(questionKey)) return "Master's degree";
  if (/wageLevel/i.test(questionKey)) return "Level III";
  if (/formNumber/i.test(questionKey)) return "I-129";
  return `${questionKey}-value`;
}

for (const formCode of ["I-129", "I-907", "I-130", "I-129F", "I-140", "I-864", "I-485", "I-765"]) {
  test(`${formCode}: the rewired graph fills exactly the same boxes with exactly the same values - from generic paths, and (fallback) from the old answers`, async (t) => {
    t.after(disconnectTestDB);
    await connectTestDB();
    const template = await USCISFormTemplate.findOne({ formCode, status: "active" }).select("-definition").lean();
    if (!template) return t.skip(`${formCode} has no active template in the test database`);
    // the graph as it was BEFORE any rewire: if the database's active graph has already been rewired, the exact rollback gives the original back, so this
    // check proves the same thing whether or not the migration has been applied to the database it runs on
    const oldGraph = planRollback(await loadBaseGraph(template)).graph;
    const { graph: newGraph, report } = planRewire(oldGraph);
    if (!report.rewired) return t.skip(`${formCode} reads none of the listed checklists`);

    // the answers: every question an edge reads, with the repeating-group row fields the edges name
    const wanted = new Map();
    (oldGraph.edges || []).forEach((item) => {
      [item.sourcePath, item.condition?.field, ...(item.transform?.fields || [])].forEach((path) => {
        const match = RAW.exec(String(path || ""));
        if (match && QUESTION_PATH_INDEX.has(match[1])) { if (!wanted.has(match[1])) wanted.set(match[1], new Set()); if (match[2]) wanted.get(match[1]).add(match[2]); }
      });
    });
    const h1b = { ...employerAnswers(), ...employeeAnswers() };
    const answers = {};
    const valueByPath = new Map(); // questions that share one generic path ask for the same fact, so they get one value
    wanted.forEach((rests, key) => {
      const own = QUESTION_PATH_INDEX.get(key).path;
      if (valueByPath.has(own)) { answers[key] = valueByPath.get(own); return; }
      answers[key] = h1b[key] !== undefined && !rests.size ? h1b[key] : sampleValue(key, rests);
      valueByPath.set(own, answers[key]);
    });

    const oldProfile = { raw: { questionnaireAnswers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, { value }])) } };
    const genericProfile = {};
    Object.entries(answers).forEach(([key, value]) => setDeep(genericProfile, QUESTION_PATH_INDEX.get(key).path, value));

    const withGraph = (graph) => FormMappingService.applyMappingGraph(structuredClone(template), { graph });
    const A = FormMappingService.mapTemplate(withGraph(oldGraph), oldProfile).fieldValues;
    const B = FormMappingService.mapTemplate(withGraph(newGraph), genericProfile).fieldValues;
    const C = FormMappingService.mapTemplate(withGraph(newGraph), oldProfile).fieldValues;

    const filled = Object.keys(A).length;
    t.diagnostic(`${formCode}: ${report.rewired} edges rewired over ${wanted.size} questions; ${filled} boxes filled from the old answers`);
    assert.ok(filled >= Math.min(report.rewired, 10), `the old graph fills ${filled} boxes: the check would prove nothing`);
    const diff = (left, right) => [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])).map((key) => `${key}: ${JSON.stringify(left[key])} vs ${JSON.stringify(right[key])}`);
    assert.deepEqual(diff(A, B), [], "generic paths fill the same values as the old question keys");
    // an edge that ALREADY had a fallback keeps it (the engine has one fallback per edge), so for those the old question key is no longer read: the box is then
    // filled from the generic path or the earlier fallback, which every migrated checklist fills. Everything else still reads the old key as its fallback.
    const displaced = new Set(newGraph.edges.filter((item) => item.partyRewire && RAW.test(String(item.partyRewire.sourcePath || "")) && item.partyRewire.fallback && item.fallback !== item.partyRewire.sourcePath).map((item) => item.targetFieldId));
    t.diagnostic(`${formCode}: ${displaced.size} boxes already had an earlier fallback (kept)`);
    const onlyKept = (values) => Object.fromEntries(Object.entries(values).filter(([key]) => !displaced.has(key)));
    assert.deepEqual(diff(onlyKept(A), onlyKept(C)), [], "the old answers still fill the rewired graph (fallback)");
  });
}
