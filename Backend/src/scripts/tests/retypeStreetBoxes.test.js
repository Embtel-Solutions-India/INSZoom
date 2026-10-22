const test = require("node:test");
const assert = require("node:assert/strict");
const { buildUpdate, countMatches, COPIES } = require("../retypeStreetBoxes");

const template = () => ({
  formFields: [
    { pdfFieldName: "form1[0].P5[0].Part2_Line3_StreetNumberName[0]", fieldType: "number", type: "number", semanticType: "number", validation: { numeric: true }, validationRules: { numeric: true } },
    { pdfFieldName: "form1[0].P5[0].Part2_Line3_AptSteFlrNumber[0]", fieldType: "number", type: "number", semanticType: "number", validation: { numeric: true } },
    { pdfFieldName: "form1[0].P5[0].Part2_Line3_CityOrTown[0]", fieldType: "text", type: "text", semanticType: "text" },
  ],
  pdfFieldMappings: [{ pdfField: "form1[0].P5[0].Part2_Line3_StreetNumberName[0]", type: "number" }, { pdfField: "form1[0].P5[0].Part2_Line3_AptSteFlrNumber[0]", type: "number" }],
  formStructure: { questions: [{ fieldName: "Pt1Line8_StreetNumberName[0]", type: "number", fieldType: "number" }] },
});

test("street, apartment-number and postal-code boxes typed number are counted - not the city, not a US ZIP code", () => {
  const t = template();
  t.formFields.push({ pdfFieldName: "form1[0].P5[0].Part2_Line3_PostalCode[0]", fieldType: "number", type: "number", semanticType: "number" }, { pdfFieldName: "form1[0].P5[0].Part2_Line3_ZipCode[0]", fieldType: "number", type: "number", semanticType: "number" });
  const found = countMatches(t);
  assert.equal(found.formFields, 3, "street + apartment number + postal code, but not the ZIP code");
  assert.equal(found.pdfFieldMappings, 2);
  assert.equal(found["formStructure.questions"], 1);
  assert.equal(found["definition.fields"], undefined, "a copy the template does not have is not counted");
});

test("the update retypes every copy to text, removes the numeric flags, and filters on the street name AND the number type", () => {
  const { update, arrayFilters } = buildUpdate();
  assert.equal(arrayFilters.length, COPIES.length);
  assert.equal(update.$set["formFields.$[b0].fieldType"], "text");
  assert.equal(update.$set["formFields.$[b0].semanticType"], "text");
  assert.ok("formFields.$[b0].validation.numeric" in update.$unset);
  assert.ok("formFields.$[b0].validationRules.numeric" in update.$unset);
  for (const filter of arrayFilters) {
    const keys = Object.keys(filter);
    assert.ok(keys.some((key) => /Street/.test(filter[key]?.$regex || "") && /Postal/.test(filter[key]?.$regex || "")), "filters on the address names");
    assert.ok(Array.isArray(filter.$or) && filter.$or.every((item) => Object.values(item)[0] === "number"), "and only when the type is number");
  }
  assert.equal(update.$set["pdfFieldMappings.$[b7].type"], "text");
  assert.equal(update.$unset["pdfFieldMappings.$[b7].validation.numeric"], undefined, "a plain field map has no validation to clear");
});

test("the update names only the arrays the template has", () => {
  const { update, arrayFilters } = buildUpdate(["formFields", "pdfFieldMappings"]);
  assert.equal(arrayFilters.length, 2);
  assert.ok(Object.keys(update.$set).every((key) => /^(formFields|pdfFieldMappings)\./.test(key)));
});
