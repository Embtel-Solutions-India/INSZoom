// DB-free unit tests for FieldLabelEnrichmentService - the label-derivation
// priority (crosswalk note > /TU tooltip > naming-pattern parse > raw
// fallback) and the uscis_use_only (barcode) classification that keeps
// USCIS-internal fields out of the review UI.
const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isUscisUseOnly,
  cleanCrosswalkNote,
  labelFromTooltip,
  labelFromNamingPattern,
  deriveLabel,
  enrichFields,
} = require("../services/FieldLabelEnrichmentService");

test("isUscisUseOnly flags PDF417 barcode fields regardless of formCode", () => {
  assert.equal(isUscisUseOnly("form1[0].#pageSet[0].Page1[0].PDF417BarCode1[0]", "I-129"), true);
  assert.equal(isUscisUseOnly("form1[0].#pageSet[0].Page1[0].PDF417BarCode1[0]", "UNKNOWN-FORM"), true, "generic barcode pattern must apply even with no crosswalk for the form");
  assert.equal(isUscisUseOnly("form1[0].#subform[2].Line1_Gender_P3[0]", "I-129"), false);
});

test("cleanCrosswalkNote keeps only the first (USCIS-facing) sentence and strips parentheticals", () => {
  assert.equal(
    cleanCrosswalkNote("Item 5, Sex - Male widget. person.gender is normalized lowercase by CanonicalTransformationService (verified empirically)."),
    "Item 5, Sex - Male widget"
  );
  assert.equal(cleanCrosswalkNote("Item 2a, New employment."), "Item 2a, New employment");
  assert.equal(cleanCrosswalkNote(undefined), undefined);
});

test("real I-129 crosswalk edges resolve to a clean label via deriveLabel", () => {
  const result = deriveLabel({ fieldName: "form1[0].#subform[2].Line1_Gender_P3[0]", tooltip: "Some tooltip text.", pageNumber: 2, formCode: "I-129" });
  assert.equal(result.labelSource, "crosswalk_note");
  assert.equal(result.label, "Item 5, Sex - Male widget");
});

test("labelFromTooltip extracts the widget-specific last sentence, with an Item-number prefix when present", () => {
  const tooltip = "Part 1. Petitioner Information. 3. Mailing Address of Individual, Company or Organization. Enter City or Town.";
  assert.equal(labelFromTooltip(tooltip, "form1[0].#subform[0].Line_CityTown[0]"), "Item 3: Enter City or Town");
});

test("labelFromTooltip returns undefined when the tooltip is just the field's own name (the barcode-field case)", () => {
  assert.equal(labelFromTooltip("PDF417BarCode1", "PDF417BarCode1"), undefined);
  assert.equal(labelFromTooltip("", "anything"), undefined);
});

test("labelFromTooltip returns undefined for an unreasonably long single-sentence tooltip rather than showing a wall of text", () => {
  const longSentence = `Enter ${"a very long instruction with no sentence breaks whatsoever that just keeps going ".repeat(3)}`;
  assert.equal(labelFromTooltip(longSentence, "field"), undefined);
});

test("labelFromNamingPattern parses Part/Section/Item tokens embedded in the XFA field name", () => {
  assert.equal(labelFromNamingPattern("form1[0].#subform[22].H1BSecALine1a_Yes[0]"), "Section A, Item 1a");
  assert.equal(labelFromNamingPattern("form1[0].#subform[3].P4Line8a_Yes[0]"), "Part 4, Item 8a");
  assert.equal(labelFromNamingPattern("form1[0].#subform[1].Part3Line2_StreetName[0]"), "Part 3, Item 2");
});

test("labelFromNamingPattern falls back to page context, never the raw internal string, when no tokens are found", () => {
  assert.equal(labelFromNamingPattern("form1[0].#subform[5].Deemed[0]", 6), "Page 6 field");
  assert.equal(labelFromNamingPattern("form1[0].#subform[5].Deemed[0]", undefined), undefined);
});

test("deriveLabel priority: crosswalk note wins over tooltip, which wins over naming pattern, which wins over the raw fallback", () => {
  const withCrosswalk = deriveLabel({ fieldName: "form1[0].#subform[1].new[0]", tooltip: "Some other tooltip text.", pageNumber: 2, formCode: "I-129" });
  assert.equal(withCrosswalk.labelSource, "crosswalk_note");

  const withTooltipOnly = deriveLabel({ fieldName: "form1[0].#subform[9].NotInCrosswalk[0]", tooltip: "Part 9. Some Section. 5. A Heading. Enter Something Specific.", pageNumber: 9, formCode: "I-129" });
  assert.equal(withTooltipOnly.labelSource, "pdf_tooltip");

  const withNamingOnly = deriveLabel({ fieldName: "form1[0].#subform[9].P9Line5_SomethingElse[0]", tooltip: "", pageNumber: 9, formCode: "I-129" });
  assert.equal(withNamingOnly.labelSource, "naming_pattern");
  assert.equal(withNamingOnly.label, "Part 9, Item 5");

  const rawFallback = deriveLabel({ fieldName: "form1[0].#subform[9].mystery[0]", tooltip: "", pageNumber: undefined, formCode: "I-129", fallback: "Mystery" });
  assert.equal(rawFallback.labelSource, "labelize_fallback");
  assert.equal(rawFallback.label, "Mystery");
});

test("enrichFields marks barcode fields uscis_use_only and never assigns them a derived label, and drops tooltip from its output", () => {
  const fields = [
    { fieldName: "form1[0].#pageSet[0].Page1[0].PDF417BarCode1[0]", tooltip: "PDF417BarCode1", pageNumber: 1 },
    { fieldName: "form1[0].#subform[2].Line1_Gender_P3[0]", tooltip: "irrelevant", pageNumber: 2, label: "Old Label" },
  ];
  const result = enrichFields(fields, "I-129");
  assert.equal(result[0].uscisUseOnly, true);
  assert.equal(result[0].label, undefined, "a uscis_use_only field must not get a derived label at all");
  assert.equal(result[0].tooltip, undefined, "tooltip must not be persisted onto the enriched output");
  assert.equal(result[1].uscisUseOnly, false);
  assert.equal(result[1].label, "Item 5, Sex - Male widget");
  assert.equal(result[1].fieldLabel, "Item 5, Sex - Male widget");
  assert.equal(result[1].tooltip, undefined);
});
