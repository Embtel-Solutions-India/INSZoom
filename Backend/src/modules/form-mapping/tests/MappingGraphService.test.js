const assert = require("node:assert/strict");
const test = require("node:test");
const MappingGraphService = require("../services/MappingGraphService");
const mappingGraphRoutes = require("../routes/mappingGraphRoutes");

function template(overrides = {}) {
  return {
    _id: "template_1",
    formCode: "I-129",
    formName: "Petition for a Nonimmigrant Worker",
    version: "01/17/25",
    visaTypes: ["H1B"],
    formFields: [
      { fieldId: "part1.petitionerName", label: "Petitioner Company Name", fieldType: "text", required: true, sectionTitle: "Part 1" },
      { fieldId: "part2.familyName", label: "Beneficiary Family Name", fieldType: "text", required: true, sectionTitle: "Part 2" },
      { fieldId: "part2.dateOfBirth", label: "Date of Birth", fieldType: "date", sectionTitle: "Part 2" },
      { fieldId: "part2.passportNumber", label: "Passport Number", fieldType: "text", sectionTitle: "Part 2" },
      { fieldId: "part5.employerName", label: "Employer Name", fieldType: "text", sectionTitle: "H-1B Employer" },
    ],
    ...overrides,
  };
}

test("MappingGraphService generates canonical-to-form relationships without values", () => {
  const graph = MappingGraphService.generateGraph(template(), {
    person: { lastName: "Doe", dob: "1990-01-01", passport: { number: "A123" } },
    company: { name: "Acme" },
    case: { visaType: "H1B" },
  });

  assert.equal(graph.formCode, "I-129");
  assert.equal(graph.summary.formFields, 5);
  assert.ok(graph.edges.find((edge) => edge.sourcePath === "company.name" && edge.targetFieldId === "part1.petitionerName"));
  assert.ok(graph.edges.find((edge) => edge.sourcePath === "person.lastName" && edge.targetFieldId === "part2.familyName"));
  assert.ok(graph.edges.find((edge) => edge.sourcePath === "person.dob" && edge.mappingType === "date"));
  assert.equal(Object.prototype.hasOwnProperty.call(graph.edges[0], "value"), false);
});

test("MappingGraphService detects invalid source and duplicate targets", () => {
  const graph = MappingGraphService.generateGraph(template());
  graph.edges.push({
    mappingId: "bad",
    sourcePath: "person.notReal",
    targetFieldId: "part2.familyName",
    mappingType: "direct",
  });
  graph.edges.push({
    mappingId: "duplicate",
    sourcePath: "person.lastName",
    targetFieldId: "part2.familyName",
    mappingType: "direct",
  });
  const validation = MappingGraphService.validateGraph(graph, template());
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => error.code === "INVALID_SOURCE"));
  assert.ok(validation.errors.some((error) => error.code === "DUPLICATE_TARGET_MAPPING"));
});

test("MappingGraphService compares mapping versions", () => {
  const left = MappingGraphService.generateGraph(template());
  const right = MappingGraphService.generateGraph(template({
    version: "04/01/26",
    formFields: [
      { fieldId: "part1.petitionerLegalName", label: "Petitioner Legal Business Name", fieldType: "text", required: true, sectionTitle: "Part 1" },
      { fieldId: "part2.familyName", label: "Beneficiary Family Name", fieldType: "text", required: true, sectionTitle: "Part 2" },
    ],
  }));
  const diff = MappingGraphService.compareGraphs(left, right);
  assert.ok(diff.summary.added >= 1);
  assert.ok(diff.summary.removed >= 1);
});

test("MappingGraphService applies graph mappings to existing template fields", () => {
  const draftTemplate = template();
  const graph = MappingGraphService.generateGraph(draftTemplate);
  MappingGraphService.applyGraphToTemplate(draftTemplate, graph);

  const mappedField = draftTemplate.formFields.find((field) => field.fieldId === "part2.familyName");
  assert.equal(draftTemplate.mappingVersion, 1);
  assert.ok(Array.isArray(mappedField.mappings));
  assert.ok(mappedField.mappings[0].sourceField);
  assert.equal(mappedField.mappings[0].source, "canonical");
});

test("MappingGraphService supports exact one-to-many edition mappings", () => {
  const graph = MappingGraphService.generateGraph(template(), {}, {
    exactMappings: {
      "part1.petitionerName": "company.name",
      "part5.employerName": "company.name",
    },
  });
  const companyEdges = graph.edges.filter((edge) => edge.sourcePath === "company.name");

  assert.equal(companyEdges.length, 2);
  assert.ok(companyEdges.every((edge) => edge.confidence === 100));
  assert.ok(companyEdges.every((edge) => edge.version === "01/17/25"));
});

test("MappingGraphService blocks activation readiness for unmapped or unreviewed fields", () => {
  const graph = MappingGraphService.generateGraph(template(), {}, { threshold: 0.99 });
  const validation = MappingGraphService.validateGraph(graph, template());

  assert.equal(validation.readyForActivation, false);
  assert.ok(validation.summary.unmapped > 0);
  assert.ok(validation.warnings.some((warning) => warning.code === "MISSING_FIELD_MAPPING" || warning.code === "MISSING_REQUIRED_MAPPING"));
});

test("mapping graph APIs expose version history and configurable field mappings", () => {
  const routes = mappingGraphRoutes.stack
    .map((layer) => ({ path: layer.route?.path, methods: layer.route?.methods }))
    .filter((route) => route.path);
  assert.ok(routes.some((route) => route.path === "/templates/:templateId/versions" && route.methods.get));
  assert.ok(routes.some((route) => route.path === "/templates/:templateId/mappings/:targetFieldId" && route.methods.put));
});
