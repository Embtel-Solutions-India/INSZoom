const assert = require("node:assert/strict");
const test = require("node:test");
const mongoose = require("mongoose");
const Answer = require("../../../models/Answer");
const Question = require("../../../models/Question");
const QuestionLibraryItem = require("../../../models/QuestionLibraryItem");
const questionLibraryService = require("../question-library.service");
const IntelligentQuestionnaireService = require("../intelligent-questionnaire.service");
const questionnaireRoutes = require("../questionnaire.routes");

function template(formCode, version, fieldOverrides = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    formCode,
    version,
    editionDate: new Date("2025-01-01"),
    parserMetadata: { confidence: 0.95, status: "parsed" },
    formFields: [{
      fieldId: "part1.dateOfBirth",
      fieldName: "Pt1Line1a_DateOfBirth",
      label: "Pt1 Line1a Date of Birth",
      type: "date",
      required: true,
      extraction: { confidence: 0.95, status: "parsed" },
      ...fieldOverrides,
    }],
  };
}

test("USCIS question library deduplicates equivalent questions across forms", () => {
  const i129 = questionLibraryService.buildCandidate(template("I-129", "01/17/2025"), template("I-129", "01/17/2025").formFields[0]);
  const i485Template = template("I-485", "10/24/2024", { required: false });
  const i485 = questionLibraryService.buildCandidate(i485Template, i485Template.formFields[0]);

  assert.equal(i129.key, i485.key);
  assert.equal(i129.canonicalPath, "person.dob");
  assert.equal(i129.sectionKey, "personal_information");

  const merged = questionLibraryService.mergeCandidate(i129, i485);
  assert.equal(merged.sourceFieldCount, 2);
  assert.deepEqual(merged.sourceForms.sort(), ["I-129", "I-485"]);
  assert.equal(merged.requirement, "mixed");
});

test("USCIS question library preserves conditional and repeatable metadata", () => {
  const form = template("I-485", "10/24/2024", {
    fieldId: "part8.children1Name",
    fieldName: "Pt8Line2_Children1Name",
    label: "Child Name",
    type: "text",
    required: false,
    repeatable: true,
    repeatableConfig: { groupKey: "children", index: 1 },
    dependencies: [{ sourceFieldId: "part8.hasChildren", operator: "equals", value: true }],
    conditionalLogic: { sourceFieldId: "part8.hasChildren", operator: "equals", value: true },
  });
  const candidate = questionLibraryService.buildCandidate(form, form.formFields[0]);

  assert.equal(candidate.sectionKey, "family_information");
  assert.equal(candidate.requirement, "conditional");
  assert.equal(candidate.repeatable, true);
  assert.equal(candidate.sources[0].dependencies.length, 1);
  assert.equal(candidate.review.status, "needs_review");
});

test("question library and questionnaire schemas reference canonical items and master data", () => {
  assert.ok(QuestionLibraryItem.schema.path("canonicalPath"));
  assert.ok(QuestionLibraryItem.schema.path("sources.formTemplate"));
  assert.ok(QuestionLibraryItem.schema.path("review.status"));
  assert.ok(Question.schema.path("libraryItem"));
  assert.ok(Question.schema.path("mapping.masterDataPath"));
  assert.ok(Answer.schema.path("masterDataPath"));
  assert.ok(Answer.schema.path("masterDataSnapshot"));
});

test("question library APIs are registered before questionnaire id routes", () => {
  const paths = questionnaireRoutes.stack
    .map((layer) => layer.route?.path)
    .filter(Boolean);
  assert.ok(paths.includes("/question-library"));
  assert.ok(paths.includes("/question-library/:itemId"));
  assert.ok(paths.includes("/question-library/custom"));
  assert.ok(paths.includes("/question-library/synchronize"));
  assert.ok(paths.indexOf("/question-library") < paths.indexOf("/:id"));
});

test("intelligent questionnaire hides completed canonical fields and exposes conflicts", () => {
  const questions = [
    { _id: "q1", key: "first_name", mapping: { canonicalPath: "person.firstName" } },
    { _id: "q2", key: "date_of_birth", mapping: { canonicalPath: "person.dob" } },
  ];
  const state = IntelligentQuestionnaireService.buildCaseQuestionState(questions, {
    profile: { person: { firstName: "Jane", dob: "1990-01-01" } },
    fieldMetadata: {
      "person.firstName": { sourceType: "ocr", confidence: 98 },
      "person.dob": { sourceType: "questionnaire", confidence: 100 },
    },
    conflicts: [{
      conflictId: "conflict-1",
      path: "person.dob",
      status: "pending_review",
      candidates: [
        { value: "1990-01-01", sourceType: "questionnaire", confidence: 100 },
        { value: "1991-01-01", sourceType: "ocr", confidence: 92 },
      ],
    }],
  });

  assert.deepEqual(state.pendingQuestions.map((question) => question.key), ["date_of_birth"]);
  assert.deepEqual(state.completedQuestions.map((item) => item.question.key), ["first_name"]);
  assert.equal(state.prefill.first_name.source, "ocr");
  assert.equal(state.conflicts.date_of_birth.candidates.length, 2);
});
