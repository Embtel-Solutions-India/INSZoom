// The legacy-findings repair and the reviewed-exception mechanism. Pure, DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const { repairGraph, OWNER_FOR, EXCEPTIONS } = require("../../../scripts/repairLegacyMappingFindings");
const { createPathUniverse } = require("../contract/PathUniverse");
const { checkEdge, isAcknowledged, CODES } = require("../contract/MappingContractValidator");
const FormMappingService = require("../services/FormMappingService");

const universe = createPathUniverse({ registry: [{ path: "petitioner.name", type: "text" }, { path: "petitioner.signatory.firstName", type: "text" }, { path: "beneficiary.firstName", type: "text" }, { path: "company.name", type: "text" }] });
const partyEdge = (over = {}) => ({ mappingId: "m1", targetFieldId: "f1", targetPdfField: "form1[0].Page1[0].Name[0]", targetLabel: "Name", section: "Part 1", targetType: "text", sourcePath: "petitioner.name", partyRule: "petitioner.name", profileOwner: "employee", transform: { type: "direct" }, status: "active", mappingType: "direct", confidence: 90, ...over });

test("the owner a party rule derives is employer for petitioner.* and employee for everything else", () => {
  assert.equal(OWNER_FOR("petitioner.name"), "employer");
  assert.equal(OWNER_FOR("petitioner.signatory.firstName"), "employer");
  assert.equal(OWNER_FOR("beneficiary.firstName"), "employee");
});

test("repair: a stale owner is recomputed and the edge is dated and marked authored; nothing else about the edge changes", () => {
  const now = new Date("2026-10-16T12:00:00Z");
  const before = partyEdge();
  const { graph, changes } = repairGraph("I-907", { edges: [before, partyEdge({ mappingId: "m2", targetFieldId: "f2", partyRule: "beneficiary.firstName", sourcePath: "beneficiary.firstName", profileOwner: "employee" })], nodes: { canonical: [] } }, now);
  const fixed = graph.edges[0];
  assert.deepEqual([fixed.profileOwner, fixed.origin, fixed.reviewedAt], ["employer", "authored", now]);
  const { profileOwner, origin, reviewedAt, ...rest } = fixed;
  const { profileOwner: _o, ...beforeRest } = before;
  assert.deepEqual(rest, beforeRest, "source path, transform, condition, status, confidence, labels are all untouched");
  assert.equal(graph.edges[1].profileOwner, "employee", "an edge that is already right is left alone");
  assert.equal(graph.edges[1].origin, undefined);
  assert.deepEqual(changes.map((item) => item.change), ["profileOwner employee -> employer"]);
  assert.equal(before.profileOwner, "employee", "the input is not modified");
});

test("repair is idempotent: running it on its own output changes nothing", () => {
  const once = repairGraph("I-907", { edges: [partyEdge()], nodes: { canonical: [] } });
  const twice = repairGraph("I-907", once.graph);
  assert.deepEqual(twice.changes, []);
  assert.deepEqual(twice.graph.edges, once.graph.edges);
});

test("what is filled is IDENTICAL before and after the repair (the owner only labels where a value came from)", () => {
  const canonical = { petitioner: { name: "Acme Corp" } };
  const fieldOf = (edges) => FormMappingService.applyMappingGraph({ formFields: [{ fieldId: "f1", fieldType: "text" }] }, { graph: { edges }, mappingVersion: 1, _id: "v" }).formFields[0];
  const before = FormMappingService.resolveField(fieldOf([partyEdge()]), canonical, {});
  const after = FormMappingService.resolveField(fieldOf(repairGraph("I-907", { edges: [partyEdge()] }).graph.edges), canonical, {});
  assert.equal(after.value, "Acme Corp");
  assert.deepEqual([after.value, after.source, after.sourceField], [before.value, before.source, before.sourceField]);
  assert.equal(before.profileOwner, "employee");
  assert.equal(after.profileOwner, "employer");
});

test("a reviewed exception silences exactly that code on exactly that edge, and only with a written reason", () => {
  const contradictory = partyEdge({ sourcePath: "company.name", partyRule: undefined, profileOwner: undefined, targetLabel: "Item 6: Enter First Name of Beneficiary or Applicant", targetPdfField: "form1[0].Page3[0].P3_Line4_NameofPetitioner[0]" });
  assert.deepEqual(checkEdge(contradictory, { universe }).map((item) => item.code), [CODES.PARTY_CONTRADICTION]);
  const reasoned = { ...contradictory, contractExceptions: [{ code: "PARTY_CONTRADICTION", reason: "Reviewed: intentional, see the authored note.", at: new Date(), by: "x" }] };
  assert.deepEqual(checkEdge(reasoned, { universe }), []);
  assert.equal(isAcknowledged(reasoned, "PARTY_CONTRADICTION"), true);
  assert.equal(isAcknowledged(reasoned, "PATH_UNKNOWN"), false, "another code is still reported");
  const withOtherProblem = { ...reasoned, sourcePath: "made.up" };
  assert.deepEqual(checkEdge(withOtherProblem, { universe }).map((item) => item.code), [CODES.PATH_UNKNOWN, CODES.PARTY_CONTRADICTION].filter((code) => code === CODES.PATH_UNKNOWN));
  for (const reason of [undefined, "", "ok", "too short"]) assert.equal(isAcknowledged({ contractExceptions: [{ code: "PARTY_CONTRADICTION", reason }] }, "PARTY_CONTRADICTION"), false, String(reason));
});

test("the I-539 exception is recorded on exactly the two NameofPetitioner widgets, once, with the reason, and a rerun adds nothing", () => {
  const edges = ["[0]", "[1]", "[2]"].map((suffix, index) => partyEdge({ mappingId: `e${index}`, partyRule: undefined, profileOwner: undefined, sourcePath: "company.name", targetPdfField: `form1[0].Page3[0].P3_Line4_NameofPetitioner${suffix}` }));
  const once = repairGraph("I-539", { edges });
  assert.deepEqual(once.graph.edges.map((edge) => (edge.contractExceptions || []).length), [1, 1, 0]);
  assert.match(once.graph.edges[0].contractExceptions[0].reason, /petitioner's name on the related Form I-129/);
  assert.equal(once.graph.edges[0].sourcePath, "company.name", "the mapping itself is left exactly as it was");
  assert.deepEqual(repairGraph("I-539", once.graph).changes, []);
  assert.deepEqual(Object.keys(EXCEPTIONS), ["I-539"]);
  assert.deepEqual(repairGraph("I-130", { edges }).changes, [], "other forms are never touched by the exception list");
});
