const test = require("node:test");
const assert = require("node:assert/strict");
const { isInterpreterOrPreparerField } = require("../config/blankFieldPolicy");
const FormMappingService = require("../services/FormMappingService");

const field = (fieldName, fieldLabel = "") => ({ fieldName: `form1[0].#subform[0].${fieldName}[0]`, fieldLabel });

test("interpreter and preparer boxes are recognised by name or label", () => {
  assert.equal(isInterpreterOrPreparerField(field("P6_Line1a_InterpretersFamilyName", "Item 1: Enter Interpreter's Family Name (Last Name)")), true);
  assert.equal(isInterpreterOrPreparerField(field("P7_Line1b_PreparersGivenName")), true);
  assert.equal(isInterpreterOrPreparerField(field("Pt9Line5_PreparerEmailAddress")), true);
  assert.equal(isInterpreterOrPreparerField(field("Pt8Line3_Daytime", "Item 3: Enter Interpreter's Daytime Telephone Number")), true);
});

test("the applicant's own boxes and declarations are not touched", () => {
  assert.equal(isInterpreterOrPreparerField(field("P5_Line3_DaytimePhoneNumber", "Item 3: Enter Petitioner's Daytime Telephone Number")), false);
  assert.equal(isInterpreterOrPreparerField(field("Pt1Line1a_FamilyName", "Item 1: Enter Family Name (Last Name)")), false);
  assert.equal(isInterpreterOrPreparerField(field("P5_Checkbox1", "I have read and understand the Acknowledgement ... as read to me by my interpreter")), false);
});

test("a mapping version never fills an interpreter / preparer box, but still fills the others", () => {
  const interpreter = "form1[0].#subform[0].Pt8Line1_InterpreterGivenName[0]";
  const applicant = "form1[0].#subform[0].Pt1Line1_GivenName[0]";
  const template = {
    formFields: [
      { fieldId: "a", fieldName: interpreter, fieldLabel: "Item 1: Enter Interpreter's Given Name", defaultValue: "X" },
      { fieldId: "b", fieldName: applicant, fieldLabel: "Item 1: Enter Given Name" },
    ],
  };
  const edge = (targetFieldId, targetPdfField) => ({ mappingId: targetFieldId, targetFieldId, targetPdfField, sourcePath: "person.firstName", status: "active", transform: { type: "direct" } });
  const version = { _id: "v", mappingVersion: 1, graph: { edges: [edge("a", interpreter), edge("b", applicant)], keepBlank: [] } };
  const applied = FormMappingService.applyMappingGraph(template, version);
  const [interpreterField, applicantField] = applied.formFields;
  assert.deepEqual(interpreterField.mappings, []);
  assert.equal(interpreterField.defaultValue, undefined);
  assert.equal(applicantField.mappings.length, 1);
});
