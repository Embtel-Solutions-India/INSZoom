// Phase 7.5 golden replay: the registry-free segmenter run on the REAL stored I-129 page text (captured read-only 2026-10-22) must reproduce, exactly, the component
// ranges and codes the registry-driven discovery stored for the live edition (2026-09-09), carry every stored code, and behave sensibly on the same file when mutated.
// No database, no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../services/ComponentSegmenter");
const { editions } = require("./fixtures/i129-page-leads.json");

const STORED_LIVE = [ // USCISFormComponentDefinition rows of the live I-129 2026-09-09 edition (ACTIVE)
  [9, 10, "I129_E_CLASSIFICATION_SUPPLEM"], [11, 12, "I129_TRADE_AGREEMENT_SUPPLEME"], [13, 20, "I129_H_CLASSIFICATION_SUPPLEM"], [21, 23, "I129_H_1B_DATA_COLLECTION_AND"],
  [24, 27, "I129_L_CLASSIFICATION_SUPPLEM"], [28, 30, "I129_O_P_CLASSIFICATION_SUPPL"], [31, 31, "I129_Q_CLASSIFICATION_SUPPLEM"], [32, 36, "I129_R_CLASSIFICATION_SUPPLEM"], [37, 38, "I129_ADDITIONAL_BENEFICIARY"],
];
const REGISTRY = [
  ["E Classification Supplement to Form I-129", "I129_E_CLASSIFICATION_SUPPLEM"], ["H Classification Supplement to Form I-129", "I129_H_CLASSIFICATION_SUPPLEM"],
  ["H-1B Data Collection and Filing Fee Exemption Supplement", "I129_H_1B_DATA_COLLECTION_AND"], ["L Classification Supplement to Form I-129", "I129_L_CLASSIFICATION_SUPPLEM"],
  ["O/P Classification Supplement to Form I-129", "I129_O_P_CLASSIFICATION_SUPPL"], ["Q Classification Supplement to Form I-129", "I129_Q_CLASSIFICATION_SUPPLEM"],
  ["R Classification Supplement to Form I-129", "I129_R_CLASSIFICATION_SUPPLEM"], ["Trade Agreement Supplement to Form I-129", "I129_TRADE_AGREEMENT_SUPPLEME"],
].map(([name, componentCode]) => ({ name, componentCode, inUse: true, source: "registry" }));
// the previous (retired 2026-02-27) edition: the registry components plus the E-1/E-2 duplicate and the manually registered continuation sheet
const PREVIOUS = [
  { startPage: 9, endPage: 10, name: "E-1/E-2 Classification Supplement to Form I-129", componentCode: "I129_E_1_E_2_CLASSIFICATION_S" },
  ...REGISTRY.map((item) => ({ ...item })),
  { startPage: 37, endPage: 38, name: "Additional Beneficiary Information", componentCode: "I129_ADDITIONAL_BENEFICIARY" },
];
const PREVIOUS_RANGES = { I129_E_CLASSIFICATION_SUPPLEM: [9, 10], I129_TRADE_AGREEMENT_SUPPLEME: [11, 12], I129_H_CLASSIFICATION_SUPPLEM: [13, 20], I129_H_1B_DATA_COLLECTION_AND: [21, 23], I129_L_CLASSIFICATION_SUPPLEM: [24, 27], I129_O_P_CLASSIFICATION_SUPPL: [28, 30], I129_Q_CLASSIFICATION_SUPPLEM: [31, 31], I129_R_CLASSIFICATION_SUPPLEM: [32, 36] };
const previousComponents = PREVIOUS.map((item) => ({ componentCode: item.componentCode, name: item.name, startPage: item.startPage || PREVIOUS_RANGES[item.componentCode]?.[0], endPage: item.endPage || PREVIOUS_RANGES[item.componentCode]?.[1] }));
const candidates = [...REGISTRY, ...PREVIOUS.map((item) => ({ name: item.name, componentCode: item.componentCode, source: "previous" }))];
const run = (pages, extra = {}) => S.segment({ pages, parentFormCode: "I-129", candidates, previous: { pages: editions["2026-02-27"], components: previousComponents }, ...extra });
const components = (result) => result.segments.filter((seg) => seg.kind === "component").map((seg) => [seg.startPage, seg.endPage, seg.componentCode]);

test("golden: the live I-129 (2026-09-09) is segmented into exactly the 9 stored ranges, with every stored code carried", () => {
  const result = run(editions["2026-09-09"]);
  assert.deepEqual(result.segments[0], { kind: "core", startPage: 1, endPage: 8 });
  assert.deepEqual(components(result), STORED_LIVE);
  assert.deepEqual(result.unclaimed, [], "pages 37-38 are the Additional Beneficiary sheet (found by comparing with the previous edition), not an unclaimed run");
  result.segments.filter((seg) => seg.kind === "component").forEach((seg) => assert.equal(seg.codeSource, "carried", `${seg.componentCode} must be carried, not derived`));
});

test("golden: the E-1/E-2 heading on the live edition carries the code the registry and the open case forms use (not the duplicate E-1/E-2 code of the retired edition)", () => {
  const e = run(editions["2026-09-09"]).segments.find((seg) => seg.startPage === 9);
  assert.equal(e.componentCode, "I129_E_CLASSIFICATION_SUPPLEM");
  assert.match(e.headingText, /E-1\/E-2 Classification Supplement/);
});

test("golden: the retired edition (2026-02-27) has the same boundaries; its headingless tail is an UNCLAIMED run until something accounts for it", () => {
  const first = S.segment({ pages: editions["2026-02-27"], parentFormCode: "I-129", candidates: REGISTRY });
  assert.deepEqual(first.segments.filter((seg) => seg.kind === "component").map((seg) => [seg.startPage, seg.endPage]), STORED_LIVE.slice(0, 8).map(([a, b]) => [a, b]));
  assert.deepEqual(first.segments.at(-1), { kind: "tail", startPage: 37, endPage: 38 });
  assert.deepEqual(first.unclaimed, [37, 38]);
});

test("a heading on page 1 is the document's own title; a body cross-reference is never a heading", () => {
  const pages = editions["2026-09-09"].slice();
  pages[0] = "Page 1 of 38\tForm I-129 Edition 09/09/26\nSupplement A to Form I-485\nDepartment of Homeland Security\n";
  // (no previous edition passed: the headingless Additional Beneficiary sheet is then an unclaimed tail, so 8 headed components)
  assert.equal(S.segment({ pages, parentFormCode: "I-129", candidates }).segments.filter((seg) => seg.kind === "component").length, 8);
  assert.equal(S.headingOf("Page 2 of 38\tForm I-129 Edition 09/09/26\nPart 1. Information About the Employer\nSee the Trade Agreement Supplement to Form I-129 for details."), null);
  assert.equal(S.headingOf("Page 8 of 38\tForm I-129 Edition 09/09/26\nPart 9. Additional Information About Your Petition For Nonimmigrant Worker\n"), null);
});

test("a standalone supplement PDF (title on page 1, no embedded supplements) gets no invented components", () => {
  const pages = ["Supplement A to Form I-485\nDepartment of Homeland Security\nU.S. Citizenship and Immigration Services\nPart 1. Information", "Page 2 of 4\nPart 2. More", "Page 3 of 4\nPart 3. Even more", "Page 4 of 4\nSignature"];
  const result = S.segment({ pages, parentFormCode: "I-485", candidates: [] });
  assert.deepEqual(result.segments, [{ kind: "core", startPage: 1, endPage: 4 }]);
});

test("mutation: an UNREGISTERED supplement inserted inside H becomes a candidate with a derived code and ENDS H's range (never absorbed)", () => {
  const pages = editions["2026-09-09"].slice();
  pages.splice(16, 0, "Page 17 of 39\tForm I-129 Edition 09/09/26\nZ Classification Supplement to Form I-129\nDepartment of Homeland Security\nU.S. Citizenship and Immigration Services\n");
  const result = run(pages);
  const byStart = Object.fromEntries(result.segments.filter((seg) => seg.kind === "component").map((seg) => [seg.startPage, seg]));
  assert.equal(byStart[13].componentCode, "I129_H_CLASSIFICATION_SUPPLEM");
  assert.equal(byStart[13].endPage, 16, "H now stops where the new supplement starts");
  assert.equal(byStart[17].codeSource, "derived");
  assert.equal(byStart[17].componentCode, "I129_Z_CLASSIFICATION_SUPPLEM");
});

test("mutation: a page inserted BEFORE the supplements shifts every range by one and every code is still carried (the headingless sheet too)", () => {
  const pages = ["Page 1 of 39\tForm I-129 Edition 09/09/26\nCover", "Page 2 of 39\tForm I-129 Edition 09/09/26\nOne extra page", ...editions["2026-09-09"].slice(1)];
  const shifted = run(pages);
  assert.deepEqual(components(shifted), STORED_LIVE.map(([a, b, code]) => [a + 1, b + 1, code]));
});

test("mutation: a RENAMED printed heading keeps the stored code (similarity, not the registry name)", () => {
  const pages = editions["2026-09-09"].slice();
  pages[27] = pages[27].replace("O and P Classifications Supplement to Form I-129", "O-1, O-2 and P Classifications Supplement to Form I-129");
  const o = run(pages).segments.find((seg) => seg.startPage === 28);
  assert.equal(o.componentCode, "I129_O_P_CLASSIFICATION_SUPPL");
  assert.equal(o.codeSource, "carried");
});

test("mutation: a REMOVED supplement (Q) leaves no Q segment and R's range is unchanged", () => {
  const pages = editions["2026-09-09"].filter((_, index) => index + 1 !== 31);
  const codes = components(run(pages)).map(([, , code]) => code);
  assert.equal(codes.includes("I129_Q_CLASSIFICATION_SUPPLEM"), false);
  assert.equal(run(pages).segments.find((seg) => seg.componentCode === "I129_R_CLASSIFICATION_SUPPLEM").endPage - run(pages).segments.find((seg) => seg.componentCode === "I129_R_CLASSIFICATION_SUPPLEM").startPage, 4);
});

test("a changed headingless tail (nothing like the previous edition's) is an UNCLAIMED run, not the old continuation sheet", () => {
  const pages = editions["2026-09-09"].slice();
  pages[36] = "Page 37 of 38\tForm I-129 Edition 09/09/26\nCompletely different closing material about something else entirely without any resemblance to beneficiaries.";
  pages[37] = "Page 38 of 38\tForm I-129 Edition 09/09/26\nCompletely different closing material about something else entirely without any resemblance to beneficiaries.";
  const result = run(pages);
  assert.equal(result.segments.at(-1).kind, "tail");
  assert.deepEqual(result.unclaimed, [37, 38]);
});
