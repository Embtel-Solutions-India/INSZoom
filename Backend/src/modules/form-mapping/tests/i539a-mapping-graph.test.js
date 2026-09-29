// Phase 3A regression test: I-539A's persisted mapping graph
// (USCISMappingVersion, not a checked-in seed file - the auto-mapping
// engine originally produced this graph directly against the real
// database) used to bind the applicant's own contact.address.line2 to the
// Interpreter's/Preparer's "Business or Organization Name" field, and
// reused the applicant's contact.address/email/phone for several other
// Interpreter/Preparer fields (a genuinely different participant with no
// canonical namespace of its own) and for non-address checkbox/travel-doc
// fields. Connects to the REAL configured MongoDB, like h1-i129-mapping.
// test.js and i539-h4-crosswalk-coverage.test.js - the mapping graph is
// master data that lives only there, never in the isolated local test DB.
const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const env = require("../../../config/env");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const MappingGraphService = require("../services/MappingGraphService");

test.before(async () => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(env.mongoUri);
});

test.after(async () => {
  await mongoose.disconnect();
});

async function loadCurrentI539AGraph() {
  const template = await USCISFormTemplate.findOne({ formCode: /I-?539A/i });
  assert.ok(template, "sanity: I-539A template must exist");
  const graph = await MappingGraphService.loadCurrentGraph(template);
  return { template, graph };
}

test("I-539A mapping graph: no edge binds contact.address.line2 to a Business/Organization Name field", async () => {
  const { graph } = await loadCurrentI539AGraph();
  const offenders = graph.edges.filter(
    (edge) => edge.sourcePath === "contact.address.line2" && /business|org/i.test(edge.targetLabel || "")
  );
  assert.deepEqual(
    offenders.map((e) => e.mappingId),
    [],
    "contact.address.line2 must never be mapped to a Business/Organization Name field again"
  );
});

test("I-539A mapping graph: Interpreter/Preparer fields never read from the applicant's own person./contact.* canonical paths", async () => {
  const { graph } = await loadCurrentI539AGraph();
  const offenders = graph.edges.filter(
    (edge) =>
      /interpreter|preparer/i.test(edge.targetLabel || "") &&
      /^(person|contact)\./.test(edge.sourcePath || "")
  );
  assert.deepEqual(
    offenders.map((e) => `${e.mappingId} (${e.targetLabel} <- ${e.sourcePath})`),
    [],
    "Interpreter/Preparer are a different participant from the applicant - their fields must stay unmapped (no canonical namespace exists for them) rather than silently reusing the applicant's own identity/contact data"
  );
});

test("I-539A mapping graph: applicant Family/Given/Middle Name fields resolve to person.lastName/firstName/middleName, never contact.address.line1", async () => {
  const { graph } = await loadCurrentI539AGraph();
  const nameFields = graph.edges.filter((edge) => /Family ?Name|Given ?Name|Middle ?Name/i.test(edge.targetLabel || ""));
  assert.ok(nameFields.length > 0, "sanity: some name fields should still be mapped");
  nameFields.forEach((edge) => {
    assert.ok(
      /^person\.(lastName|firstName|middleName)$/.test(edge.sourcePath),
      `${edge.mappingId} (${edge.targetLabel}) must map to a real person.* name field, got "${edge.sourcePath}"`
    );
  });
});
