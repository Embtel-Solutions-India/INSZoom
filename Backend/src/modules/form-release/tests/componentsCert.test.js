// Phase 7.5: the component check of the certification and the core-page resolution, behind FORM_PIPELINE_AUTONOMY. Off must be today's behavior exactly.
// No database (the model queries are replaced), no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateComponentSlice } = require("../../uscis-forms/services/ComponentSegmenter");
const certPolicy = require("../certPolicy");
const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");
const ComponentPageResolver = require("../../form-generation/services/ComponentPageResolver");

const withMode = async (mode, fn) => {
  const before = process.env.FORM_PIPELINE_AUTONOMY;
  if (mode === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = mode;
  try { return await fn(); } finally { if (before === undefined) delete process.env.FORM_PIPELINE_AUTONOMY; else process.env.FORM_PIPELINE_AUTONOMY = before; }
};

const active = (code, start, end, fieldCount = 10) => ({ componentCode: code, status: "ACTIVE", pageRanges: [{ startPage: start, endPage: end }], fieldCount });

test("evaluateComponentSlice: a parent with no components has nothing to check (no false failure for ordinary forms); placeholder ranges of unmatched registry rows do not count", () => {
  assert.deepEqual(evaluateComponentSlice({ results: [], totalPages: 20 }), []);
  assert.deepEqual(evaluateComponentSlice({ results: [{ componentCode: "I864_CONTRACT", status: "REVIEW_REQUIRED", pageRanges: [{ startPage: 1, endPage: 1 }], fieldCount: 0 }], totalPages: 12 }), []);
});

test("evaluateComponentSlice: every page after the first supplement must belong to a component", () => {
  const ok = evaluateComponentSlice({ results: [active("A", 3, 5), active("B", 6, 9)], totalPages: 9 });
  assert.deepEqual(ok, []);
  const gap = evaluateComponentSlice({ results: [active("A", 3, 5), active("B", 8, 9)], totalPages: 9 });
  assert.match(gap.join(" "), /pages 6, 7 belong to no component/);
});

test("evaluateComponentSlice: an unregistered supplement (candidate) is a problem; an active component without fields is a problem", () => {
  const candidate = { componentCode: "I129_Z", status: "REVIEW_REQUIRED", verificationMethod: "segmenter_new_component_candidate", pageRanges: [{ startPage: 6, endPage: 7 }], fieldCount: 0 };
  assert.match(evaluateComponentSlice({ results: [active("A", 3, 5), candidate], totalPages: 7 }).join(" "), /unregistered supplement.*pages 6-7/);
  assert.match(evaluateComponentSlice({ results: [active("A", 3, 5, 0)], totalPages: 5 }).join(" "), /active but has no fields/);
});

test("evaluateComponentSlice: a component the previous edition served keeps a plausible size", () => {
  const previousDefs = [{ componentCode: "A", pageRanges: [{ startPage: 3, endPage: 5 }], fieldCount: 30 }];
  assert.deepEqual(evaluateComponentSlice({ results: [active("A", 3, 6, 36)], totalPages: 6, previousDefs }), []);
  assert.match(evaluateComponentSlice({ results: [active("A", 3, 12, 30)], totalPages: 12, previousDefs }).join(" "), /changed size from 3 to 10 pages/);
  assert.match(evaluateComponentSlice({ results: [active("A", 3, 5, 3)], totalPages: 5, previousDefs }).join(" "), /changed from 30 to 3 fields/);
});

test("certPolicy: components_slice stays overridable with off and shadow; with on it is critical (an admin override no longer waves it through)", async () => {
  const failedComponents = { importMetadata: { validationSummary: { certification: { passed: false, checks: [{ name: "components_slice", passed: false }] } } } };
  const req = { body: { overrideReason: "reviewed by hand, supplement pages checked" } };
  for (const mode of [undefined, "off", "shadow"]) {
    assert.equal(await withMode(mode, () => certPolicy.classify("components_slice")), "non_critical");
    assert.equal((await withMode(mode, () => certPolicy.certificationDecision(failedComponents, req))).ok, true, `mode ${mode}: today's override still works`);
  }
  assert.equal(await withMode("on", () => certPolicy.classify("components_slice")), "critical");
  const decision = await withMode("on", () => certPolicy.certificationDecision(failedComponents, req));
  assert.equal(decision.ok, false);
  assert.match(decision.error, /critical check \(components_slice\)/);
  assert.equal(await withMode("on", () => certPolicy.classify("viewer_download")), "non_critical", "nothing else changes");
});

function stubDefinitions(rows) {
  const original = USCISFormComponentDefinition.find;
  USCISFormComponentDefinition.find = (filter) => ({ lean: async () => rows.filter((row) => row.parentTemplateId === filter.parentTemplateId && row.status === filter.status && (!filter.verificationMethod || row.verificationMethod === filter.verificationMethod)) });
  return () => { USCISFormComponentDefinition.find = original; };
}
const template = { _id: "t1", formCode: "I-129", version: "v" };
const rows = [
  { parentTemplateId: "t1", status: "ACTIVE", parentFormCode: "I-129", componentCode: "A", pageRanges: [{ startPage: 3, endPage: 4 }] },
  { parentTemplateId: "t1", status: "REVIEW_REQUIRED", parentFormCode: "I-129", componentCode: "Z", verificationMethod: "segmenter_new_component_candidate", pageRanges: [{ startPage: 5, endPage: 6 }] },
  { parentTemplateId: "t1", status: "REVIEW_REQUIRED", parentFormCode: "I-129", componentCode: "OTHER", verificationMethod: "pdf_text_heading_search+field_page_crossref", pageRanges: [{ startPage: 1, endPage: 1 }] },
];

test("resolveCorePages: off and shadow render exactly the pages they always did; on also keeps a new-component candidate's pages out of the core form (and never a placeholder range)", async () => {
  const restore = stubDefinitions(rows);
  try {
    assert.deepEqual(await withMode(undefined, () => ComponentPageResolver.resolveCorePages(template, 8)), [1, 2, 5, 6, 7, 8]);
    assert.deepEqual(await withMode("shadow", () => ComponentPageResolver.resolveCorePages(template, 8)), [1, 2, 5, 6, 7, 8]);
    assert.deepEqual(await withMode("on", () => ComponentPageResolver.resolveCorePages(template, 8)), [1, 2, 7, 8]);
  } finally { restore(); }
});

test("resolveCorePages: a parent with no ACTIVE component is untouched even with candidates (null = render every page)", async () => {
  const restore = stubDefinitions(rows.filter((row) => row.status !== "ACTIVE"));
  try {
    assert.equal(await withMode("on", () => ComponentPageResolver.resolveCorePages(template, 8)), null);
  } finally { restore(); }
});
