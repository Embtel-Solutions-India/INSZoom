import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// Items the case manager asked THIS client for are shown first, in a group of their own, ahead of every other document and text question,
// and are not repeated in their normal place. A case with no request is untouched. useCaseQuestionnaire is mocked (stable references).
const questionnaire = { _id: "q1", title: "O-1B Employee Checklist", sections: [{ key: "personal", title: "Personal", order: 1 }, { key: "work", title: "Work", order: 2 }] };
const requestedMeta = { requestedByStaff: { requestId: "r1", note: "clear scan" } };
const plainFields = [
  { _id: "f1", key: "first_name", label: "First name", type: "text", sectionKey: "personal", order: 1 },
  { _id: "f2", key: "salary", label: "Salary", type: "text", sectionKey: "work", order: 2, required: true, metadata: requestedMeta },
];
const plainDocs = [
  { _id: "d1", key: "passport", label: "Passport", type: "file", sectionKey: "personal", order: 3 },
  { _id: "d2", key: "degree", label: "Academic Certificates", type: "file", sectionKey: "work", order: 4, required: true, metadata: requestedMeta },
];
const noAnswers = [];
const progress = { completionPercentage: 0 };
let current = { fieldQuestions: plainFields, documentQuestions: plainDocs };

vi.mock("../services/api", () => ({ questionnairesApi: { saveAnswer: vi.fn() } }));
vi.mock("./useCaseQuestionnaire", () => ({
  default: () => ({ questionnaire, documentQuestions: current.documentQuestions, fieldQuestions: current.fieldQuestions, answers: noAnswers, responseId: "r1", progress, loading: false, error: null, refetch: vi.fn() }),
}));

const { default: useQuestionnaireAnswers } = await import("./useQuestionnaireAnswers");

describe("requested items come first", () => {
  it("a 'Requested by your case manager' group is the FIRST section and holds the requested document AND text item", () => {
    current = { fieldQuestions: plainFields, documentQuestions: plainDocs };
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));
    expect(result.current.sections[0].title).toBe("Requested by your case manager");
    const requested = result.current.questionsBySection.get(result.current.sections[0].key);
    expect(requested.map((q) => q.key).sort()).toEqual(["degree", "salary"]);
    expect(result.current.requestedQuestions.map((q) => q.key).sort()).toEqual(["degree", "salary"]);
  });

  it("requested items are not repeated in their normal sections or in the Documents group", () => {
    current = { fieldQuestions: plainFields, documentQuestions: plainDocs };
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));
    const { questionsBySection } = result.current;
    expect((questionsBySection.get("work") || []).map((q) => q.key)).toEqual([]); // "salary" moved up
    expect((questionsBySection.get("personal") || []).map((q) => q.key)).toEqual(["first_name"]);
    expect(result.current.sections.map((s) => s.title)).toEqual(["Requested by your case manager", "Personal", "Work", "Documents"]);
    expect(questionsBySection.get("__documents__").map((q) => q.key)).toEqual(["passport"]);
  });

  it("a requested question still counts as required (and as missing while blank)", () => {
    current = { fieldQuestions: plainFields, documentQuestions: plainDocs };
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));
    expect(result.current.missingRequiredCount).toBe(2);
  });

  it("with NO request on the case nothing changes: same sections, no requested group", () => {
    current = {
      fieldQuestions: plainFields.map(({ metadata, ...rest }) => rest),
      documentQuestions: plainDocs.map(({ metadata, ...rest }) => rest),
    };
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));
    expect(result.current.sections.map((s) => s.title)).toEqual(["Personal", "Work", "Documents"]);
    expect(result.current.requestedQuestions).toEqual([]);
    expect((result.current.questionsBySection.get("__documents__") || []).map((q) => q.key).sort()).toEqual(["degree", "passport"]);
  });
});
