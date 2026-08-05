import { describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Phase H2 AC2: prove the backend's questionnairePrefill contract (key,
// value, label, confidence, sourceDocumentType, targetSystem, applied,
// conflict) round-trips through the real, unmodified handleAutofillResult
// without error and produces the correct applied/conflict-derived status
// message. useCaseQuestionnaire is mocked (same pattern as App.test.jsx)
// since it performs a real API call on mount - handleAutofillResult itself
// never touches the network, only refetch()/setState.
// Stable references (not fresh literals per call) - useQuestionnaireAnswers's
// own effect is keyed on [questionnaire?._id, rawAnswers]; a mock that
// returns a new array/object identity on every call defeats that dependency
// check and free-runs into an infinite render loop.
const mockQuestionnaire = { _id: "q1", title: "H-1B Employee Checklist", sections: [] };
const mockEmptyArray = [];
const mockProgress = { completionPercentage: 0 };
const mockRefetch = vi.fn();

vi.mock("./useCaseQuestionnaire", () => ({
  default: () => ({
    questionnaire: mockQuestionnaire,
    documentQuestions: mockEmptyArray,
    fieldQuestions: mockEmptyArray,
    answers: mockEmptyArray,
    responseId: "r1",
    progress: mockProgress,
    loading: false,
    error: null,
    refetch: mockRefetch,
  }),
}));

const { default: useQuestionnaireAnswers } = await import("./useQuestionnaireAnswers");

describe("useQuestionnaireAnswers.handleAutofillResult (Phase H2 AC2)", () => {
  it("runs without error against the real backend prefill shape and counts applied/conflict correctly", () => {
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));

    act(() => {
      result.current.handleAutofillResult("passport", {
        prefill: [
          { key: "employee_personal_firstName", value: "Ada", label: "First Name", confidence: 91, sourceDocumentType: "passport", targetSystem: "answer", applied: true, conflict: false },
          { key: "employee_personal_lastName", value: "Curie", label: "Last Name", confidence: 90, sourceDocumentType: "passport", targetSystem: "answer", applied: false, conflict: true },
          { key: "employer.company.fullName", value: "Acme Analytics Incorporated", label: "Company Legal Name", confidence: 81, sourceDocumentType: "passport", targetSystem: "masterData", applied: false, conflict: false },
        ],
      });
    });

    expect(result.current.statusMessage).toContain("Applied 1 field");
    expect(result.current.statusMessage).toContain("1 needs your review below");
  });

  it("shows a clear message and does not throw when nothing matched", () => {
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));

    act(() => {
      result.current.handleAutofillResult("passport", { prefill: [] });
    });

    expect(result.current.statusMessage).toMatch(/couldn't find any matching fields/i);
  });

  it("surfaces the error message and does not crash when the upload itself failed", () => {
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));

    act(() => {
      result.current.handleAutofillResult("passport", null, new Error("Unable to process the uploaded document"));
    });

    expect(result.current.statusMessage).toBe("Unable to process the uploaded document");
  });
});
