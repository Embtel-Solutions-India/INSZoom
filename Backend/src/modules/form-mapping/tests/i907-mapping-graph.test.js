// Phase 3B regression test: I-907's persisted mapping graph
// (USCISMappingVersion, live database data - not a checked-in seed file)
// used to bind contact.address.line2 to the "Classification or Eligibility
// Requested" field, and to the Representative's Name / Interpreter's &
// Preparer's "Business or Organization Name" fields (different
// participants from the applicant, with no canonical namespace of their
// own) - same bug class fixed on I-539A. Connects to the REAL configured
// MongoDB, like i539a-mapping-graph.test.js.
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

async function loadCurrentI907Graph() {
  const template = await USCISFormTemplate.findOne({ formCode: "I-907" });
  assert.ok(template, "sanity: I-907 template must exist");
  const graph = await MappingGraphService.loadCurrentGraph(template);
  return { template, graph };
}

test("I-907 mapping graph: Classification or Eligibility Requested resolves to case.visaType, never contact.address.line2", async () => {
  const { graph } = await loadCurrentI907Graph();
  const field = graph.edges.find((edge) => /Classification or Eligibility Requested/i.test(edge.targetLabel || ""));
  assert.ok(field, "sanity: the field should still be mapped");
  assert.equal(field.sourcePath, "case.visaType");
});

test("I-907 mapping graph: Representative/Interpreter/Preparer fields never read from the applicant's own person./contact.* canonical paths", async () => {
  const { graph } = await loadCurrentI907Graph();
  const offenders = graph.edges.filter(
    (edge) =>
      /representative|interpreter|preparer/i.test(edge.targetLabel || "") &&
      /^(person|contact)\./.test(edge.sourcePath || "")
  );
  assert.deepEqual(
    offenders.map((e) => `${e.mappingId} (${e.targetLabel} <- ${e.sourcePath})`),
    [],
    "Representative/Interpreter/Preparer are different participants from the applicant - their fields must stay unmapped rather than silently reusing the applicant's own identity/contact data"
  );
});
