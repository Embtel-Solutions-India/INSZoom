// Phase 7.3 proof (b): the REAL I-485 case. The 2026-09-18 edition renamed every A-Number widget, which broke 24 of the 40 mapping edges when the previous edition's mapping was
// carried forward (see i485-edition-2026-09-18.test.js). The fixture is a compact, read-only copy of the two stored editions (field metadata only: names, help text, type, page, position,
// options) and of both editions' mapping edges, produced by `node src/scripts/evaluateFieldMatcher.js --dump-fixture I-485 --out <file>`. No database.
// Ground truth = the NEWER edition's own mapping (authored by the I-485 crosswalk): a carried edge is CORRECT when the newer mapping sends the same canonical source to the very box we carried it to.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fixture = require(path.join(__dirname, "fixtures", "i485-editions-real.json"));
const { carryForwardGraph } = require("../services/EditionMigrationService");

const previousTemplate = { formFields: fixture.previousFields };
const nextTemplate = { _id: "next", formCode: "I-485", version: fixture.to, editionDate: fixture.to, title: "I-485", formFields: fixture.nextFields };
const previousGraph = { version: fixture.from, nodes: { canonical: [...new Set(fixture.previousEdges.map((edge) => edge.sourcePath))].map((p) => ({ path: p, label: p, type: "text" })), form: [] }, edges: fixture.previousEdges };
const truth = new Set(fixture.nextEdges.map((edge) => `${edge.sourcePath}|${edge.targetPdfField}`));
const truthSources = new Set(fixture.nextEdges.map((edge) => edge.sourcePath));

const run = (mode) => {
  const saved = process.env.FORM_PIPELINE_AUTONOMY;
  process.env.FORM_PIPELINE_AUTONOMY = mode;
  try { return carryForwardGraph(JSON.parse(JSON.stringify(previousGraph)), JSON.parse(JSON.stringify(nextTemplate)), { previousTemplate }); } finally { if (saved === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = saved; }
};

test("fixture sanity: two real editions, the previous mapping has 40 edges", () => {
  assert.equal(fixture.formCode, "I-485");
  assert.equal(fixture.previousEdges.length, 40);
  assert.ok(fixture.previousFields.length > 500 && fixture.nextFields.length > 500);
});

test("TODAY (switch off): 24 of the 40 edges are lost on the new edition", () => {
  const off = run("off");
  assert.equal(off.lostEdges.length, 24);
  assert.equal(off.renamedEdges.length, 1);
});

test("shadow changes nothing", () => {
  const off = run("off");
  const shadow = run("shadow");
  assert.equal(JSON.stringify(shadow.lostEdges), JSON.stringify(off.lostEdges));
  assert.equal(shadow.graph.edges.length, off.graph.edges.length);
});

test("WITH the matcher (switch on): every lost edge is recovered, every one is correct against the newer edition's own mapping, none is wrong, all need a person's confirmation", () => {
  const on = run("on");
  const recovered = on.renamedEdges.length - 1; // one rename was already found by the current strict rule
  const byMapping = new Map(previousGraph.edges.map((edge) => [edge.mappingId, edge]));
  let correct = 0;
  let wrong = 0;
  let unverifiable = 0;
  for (const renamed of on.renamedEdges) {
    const source = byMapping.get(renamed.mappingId).sourcePath;
    if (!truthSources.has(source)) unverifiable += 1;
    else if (truth.has(`${source}|${renamed.to}`)) correct += 1;
    else wrong += 1;
  }
  console.log(`I-485 ${fixture.from} -> ${fixture.to}: edges 40 | current: lost 24 | matcher: recovered ${recovered} more (${correct} correct, ${wrong} wrong, ${unverifiable} unverifiable), lost ${on.lostEdges.length}`);
  assert.equal(wrong, 0, "ZERO wrong carries");
  assert.equal(on.lostEdges.length, 0);
  assert.equal(recovered, 24);
  assert.equal(correct, on.renamedEdges.length);
  const reviewed = on.graph.edges.filter((edge) => edge.evidence?.renamedFrom);
  assert.equal(reviewed.length, 25);
  assert.ok(reviewed.every((edge) => edge.status === "needs_review"), "a carried rename is never active");
  assert.equal(on.graph.edges.filter((edge) => edge.status === "active").length, 15);
});

test("no two edges end on the same new box (one-to-one)", () => {
  const on = run("on");
  const targets = on.graph.edges.map((edge) => edge.targetFieldId);
  assert.equal(new Set(targets).size, targets.length);
});
