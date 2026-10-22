const test = require("node:test");
const assert = require("node:assert/strict");
const { repairGraph, onlyMetadataChanged } = require("../repairRewiredEdgeMetadata");

const edge = (id, extra = {}) => ({ mappingId: `m:${id}`, targetFieldId: id, targetPdfField: `form.${id}[0]`, sourcePath: "petitioner.address.city", status: "active", origin: "legacy", partyRule: "petitioner.address.city", profileOwner: "employer", partyRewire: { sourcePath: "raw.x" }, ...extra });

test("a rewired legacy edge becomes authored, with no reviewer recorded, and nothing it fills changes", () => {
  const graph = { edges: [edge("a"), edge("untouched", { partyRewire: undefined })] };
  const { graph: next, changes } = repairGraph("I-130", JSON.parse(JSON.stringify(graph)));
  assert.equal(next.edges[0].origin, "authored");
  assert.ok(next.edges[0].rewireMarkedAt);
  assert.equal(next.edges[0].reviewedBy, undefined);
  assert.equal(next.edges[1].origin, "legacy", "an edge the rewire never touched is left alone");
  assert.equal(changes.length, 1);
  assert.equal(onlyMetadataChanged(graph, next), true);
});

test("a repeating row's label is made to follow its source path; a second run changes nothing", () => {
  const row = edge("row", { sourcePath: "petitioner.addressHistory.1.city", partyRule: "petitioner.addressHistory" });
  const { graph: once, changes } = repairGraph("I-130", { edges: [row] });
  assert.equal(once.edges[0].partyRule, "petitioner.addressHistory.1.city");
  assert.ok(changes.some((item) => /partyRule/.test(item.change)));
  assert.equal(repairGraph("I-130", once).changes.length, 0);
});

test("the label follows the first path of a composite transform, as the contract expects", () => {
  const combo = edge("combo", { sourcePath: "petitioner.fullName", transform: { type: "concat", fields: ["petitioner.firstName", "petitioner.lastName"] }, partyRule: "petitioner.fullName" });
  assert.equal(repairGraph("I-130", { edges: [combo] }).graph.edges[0].partyRule, "petitioner.firstName");
});

test("the three reviewed exceptions are written once, with a reason, and only for their own edge", () => {
  const target = edge("part4.form10Subform6Part4Line26NameOfCompany0", { sourcePath: "beneficiary.employmentHistory.0.employerName", partyRule: "beneficiary.employmentHistory.0.employerName" });
  const other = edge("other");
  const { graph: next } = repairGraph("I-130", { edges: [target, other] });
  assert.equal(next.edges[0].contractExceptions.length, 1);
  assert.ok(next.edges[0].contractExceptions[0].reason.length >= 10);
  assert.equal(next.edges[1].contractExceptions, undefined);
  assert.equal(repairGraph("I-130", next).graph.edges[0].contractExceptions.length, 1, "never recorded twice");
  assert.equal(repairGraph("I-907", { edges: [target] }).graph.edges[0].contractExceptions, undefined, "only for the form it was reviewed on");
});

test("a change to anything but the three allowed keys is detected", () => {
  const graph = { edges: [edge("a")] };
  const tampered = JSON.parse(JSON.stringify(repairGraph("I-130", graph).graph));
  tampered.edges[0].sourcePath = "petitioner.address.line1";
  assert.equal(onlyMetadataChanged(graph, tampered), false);
});
