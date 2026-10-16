// Phase 2 / Rule A: the mapping policy, the path universe and the transform list. Pure, DB-free.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const policy = require("../contract/MappingPolicy");
const { createPathUniverse, loadPathUniverse } = require("../contract/PathUniverse");
const { APPLY_TRANSFORMS, DERIVED_TRANSFORMS, SUPPORTED_TRANSFORMS, CONDITION_OPERATORS } = require("../contract/transformTypes");

const edge = (over = {}) => ({ mappingId: "m", targetFieldId: "t1", sourcePath: "person.firstName", status: "active", ...over });

test("origins rank authored < legacy < inferred < ai < scored; an edge with no (or an unknown) origin is legacy", () => {
  assert.deepEqual(policy.ORIGINS, ["authored", "legacy", "inferred", "ai", "scored"]);
  assert.equal(policy.originOf(edge()), "legacy");
  assert.equal(policy.originOf(edge({ origin: "magic" })), "legacy");
  assert.equal(policy.originOf(edge({ origin: "authored" })), "authored");
  const ranks = policy.ORIGINS.map(policy.rankOf);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.equal(policy.rankOf("nonsense"), policy.rankOf("legacy"));
});

test("only ACTIVE edges are projected to autofill (needs_review, rejected and status-less edges are not)", () => {
  assert.equal(policy.isProjectable(edge()), true);
  for (const status of ["needs_review", "rejected", undefined, "", "draft"]) assert.equal(policy.isProjectable(edge({ status })), false, String(status));
  assert.equal(policy.isProjectable(null), false);
});

test("a lower-ranked edge never replaces a higher-ranked one; equal or higher may", () => {
  assert.equal(policy.canReplace(edge({ origin: "authored" }), edge({ origin: "scored" })).allowed, false);
  assert.equal(policy.canReplace(edge({ origin: "authored" }), edge({ origin: "inferred" })).allowed, false);
  assert.equal(policy.canReplace(edge(), edge({ origin: "ai" })).allowed, false, "legacy beats ai");
  assert.equal(policy.canReplace(edge({ origin: "inferred" }), edge({ origin: "inferred" })).allowed, true);
  assert.equal(policy.canReplace(edge({ origin: "scored" }), edge({ origin: "authored" })).allowed, true);
  assert.equal(policy.canReplace(undefined, edge({ origin: "scored" })).allowed, true);
  assert.match(policy.canReplace(edge({ origin: "authored" }), edge({ origin: "ai" })).reason, /ai edge cannot replace an authored edge/);
});

test("a NEW scored or ai suggestion that asks to be active is stored as needs_review; inferred and authored are left alone", () => {
  for (const origin of ["scored", "ai"]) {
    const admitted = policy.admitNewEdge(edge({ origin }));
    assert.equal(admitted.status, "needs_review", origin);
    assert.equal(admitted.evidence.downgradedFrom, "active");
  }
  assert.equal(policy.admitNewEdge(edge({ origin: "inferred" })).status, "active");
  assert.equal(policy.admitNewEdge(edge({ origin: "authored" })).status, "active");
  assert.equal(policy.admitNewEdge(edge({ origin: "scored", status: "needs_review" })).status, "needs_review");
  const original = edge({ origin: "scored" });
  policy.admitNewEdge(original);
  assert.equal(original.status, "active", "the input object is not modified");
});

test("reconcile stamps origins: an unchanged edge inherits its live origin, anything else with no origin is legacy", () => {
  const previous = { edges: [edge({ targetFieldId: "a", sourcePath: "p.a", origin: "authored" }), edge({ targetFieldId: "b", sourcePath: "p.b" })] };
  const next = { edges: [edge({ targetFieldId: "a", sourcePath: "p.a" }), edge({ targetFieldId: "b", sourcePath: "p.b" }), edge({ targetFieldId: "c", sourcePath: "p.c" })], validation: { x: 1 } };
  const { graph, conflicts, stamped } = policy.reconcile(previous, next);
  assert.deepEqual(graph.edges.map((item) => item.origin), ["authored", "legacy", "legacy"]);
  assert.equal(stamped, 3);
  assert.deepEqual(conflicts, []);
  assert.equal(graph.conflicts, undefined);
  assert.deepEqual(graph.validation, { x: 1 }, "everything else on the graph is kept");
});

test("reconcile keeps the live higher-ranked edge when a lower-ranked one tries to change its source, and records the attempt", () => {
  const previous = { edges: [edge({ targetFieldId: "a", sourcePath: "person.firstName", origin: "authored", mappingId: "live" })] };
  const attempt = { edges: [edge({ targetFieldId: "a", sourcePath: "person.lastName", origin: "scored", mappingId: "guess" })] };
  const { graph, conflicts } = policy.reconcile(previous, attempt);
  assert.equal(graph.edges[0].mappingId, "live");
  assert.equal(graph.edges[0].sourcePath, "person.firstName");
  assert.deepEqual(conflicts[0].kept, { mappingId: "live", sourcePath: "person.firstName", origin: "authored" });
  assert.equal(conflicts[0].rejected.origin, "scored");
  assert.equal(graph.conflicts.length, 1);
  // an authored edge may change it
  const authored = policy.reconcile(previous, { edges: [edge({ targetFieldId: "a", sourcePath: "person.lastName", origin: "authored" })] });
  assert.equal(authored.graph.edges[0].sourcePath, "person.lastName");
  // a non-active live edge is not defended (it was never projected)
  const draft = policy.reconcile({ edges: [edge({ targetFieldId: "a", origin: "authored", status: "needs_review" })] }, attempt);
  assert.equal(draft.graph.edges[0].sourcePath, "person.lastName");
});

test("reconcile never drops an edge and never changes an existing edge's status", () => {
  const previous = { edges: [edge({ targetFieldId: "a" }), edge({ targetFieldId: "b", status: "needs_review" })] };
  const next = { edges: [edge({ targetFieldId: "b", status: "needs_review" })] };
  const { graph } = policy.reconcile(previous, next);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].status, "needs_review");
  assert.deepEqual(policy.summarize({ edges: [edge({ origin: "authored" }), edge(), edge({ status: "needs_review", origin: "scored" })] }), { byOrigin: { authored: 1, legacy: 1, scored: 1 }, byStatus: { active: 2, needs_review: 1 } });
});

// ---------------------------------------------------------------- path universe ----
test("the path universe: registry, alias, profile, library, rule, raw, ancestor and array notation", () => {
  const universe = createPathUniverse({ registry: [{ path: "person.firstName", type: "text" }, { path: "beneficiary.usMailingAddress", type: "text" }], alias: ["petitioner.name"], profile: ["employment.salary"], library: ["q.custom"], rules: ["employment.offSiteWorkLocations"] });
  const via = (p) => universe.check(p).via;
  assert.equal(via("person.firstName"), "registry");
  assert.equal(via("petitioner.name"), "alias");
  assert.equal(via("employment.salary"), "profile");
  assert.equal(via("q.custom"), "library");
  assert.equal(via("employment.offSiteWorkLocations"), "rule");
  assert.equal(via("raw.questionnaireAnswers.anything_at_all"), "raw");
  assert.equal(via("beneficiary.usMailingAddress.line1"), "ancestor", "a child of a registered object path");
  assert.equal(universe.check("employment.offSiteWorkLocations[0]").known, true, "[0] is reduced to its base");
  assert.equal(universe.check("employment.offSiteWorkLocations[]").known, true);
  assert.equal(universe.check("employment.offSiteWorkLocations.*").known, true);
  for (const unknown of ["nothing.here", "", undefined, "person", "Person.firstName"]) assert.equal(universe.check(unknown).known, false, String(unknown));
  assert.equal(universe.check("person.firstName").exact, true);
  assert.equal(universe.check("beneficiary.usMailingAddress.line1").exact, false);
});

test("the live universe (static registry files, party aliases, profile maps and the authored party rules) resolves the paths the pipeline's own rules use", async () => {
  const universe = await loadPathUniverse({ libraryPaths: ["lib.example"], force: true });
  for (const known of ["person.firstName", "beneficiary.firstName", "petitioner.signatory.firstName", "petitioner.address.line1", "employment.offSiteWorkLocations", "beneficiary.usMailingAddress.line1", "lib.example", "company.name"]) {
    assert.equal(universe.check(known).known, true, known);
  }
  assert.equal(universe.check("definitely.not.a.path").known, false);
  assert.ok(universe.size > 450);
});

// ---------------------------------------------------------------- transform list drift ----
const resolverSource = fs.readFileSync(path.join(__dirname, "..", "services", "MappingResolver.js"), "utf8");
const section = (start, end) => resolverSource.slice(resolverSource.indexOf(start), resolverSource.indexOf(end));

test("the contract's transform list is exactly what MappingResolver implements (it cannot drift)", () => {
  const applied = [...section("static applyTransform", "static getSourcePath").matchAll(/case "([A-Za-z]+)"/g)].map((match) => match[1]).filter((name) => name !== "");
  assert.deepEqual([...new Set(applied)].sort(), [...APPLY_TRANSFORMS].sort());
  const derivedBlock = section("static resolveDerivedValue", "static applyTransform");
  const derived = [...derivedBlock.matchAll(/type === "([A-Za-z]+)"/g)].map((match) => match[1]);
  const listed = [...derivedBlock.matchAll(/\["checkbox", "radio", "dropdown"\]/g)].length ? ["radio", "dropdown", "checkbox"] : [];
  for (const name of [...derived, ...listed]) assert.ok(SUPPORTED_TRANSFORMS.includes(name), `derived transform ${name} is in the contract list`);
  for (const name of DERIVED_TRANSFORMS) assert.ok(derivedBlock.includes(`"${name}"`), `${name} is handled by the resolver`);
});

test("the contract's condition operators are exactly what MappingResolver.compare implements", () => {
  const compare = section("static compare", "static resolveConditionalRule");
  const operators = [...compare.matchAll(/case "([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(operators)].sort(), [...CONDITION_OPERATORS].sort());
});
