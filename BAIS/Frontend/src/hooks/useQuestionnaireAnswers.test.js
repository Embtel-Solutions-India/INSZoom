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
const mockFieldQuestions = [
  { key: "employee_personal_firstName", label: "First Name", type: "text", sectionKey: "personal" },
  { key: "employee_personal_lastName", label: "Last Name", type: "text", sectionKey: "personal" },
  { key: "employer_position_jobTitle", label: "Job Title", type: "text", sectionKey: "position" },
  { key: "employer_position_socCode", label: "SOC Code", type: "text", sectionKey: "position" },
];
const mockProgress = { completionPercentage: 0 };
const mockRefetch = vi.fn();
const mockSaveAnswer = vi.hoisted(() => vi.fn(async () => ({ success: true, data: { answers: [] } })));

vi.mock("../services/api", () => ({
  questionnairesApi: {
    saveAnswer: mockSaveAnswer,
  },
}));

vi.mock("./useCaseQuestionnaire", () => ({
  default: () => ({
    questionnaire: mockQuestionnaire,
    documentQuestions: mockEmptyArray,
    fieldQuestions: mockFieldQuestions,
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
  beforeEach(() => {
    mockRefetch.mockClear();
    mockSaveAnswer.mockClear();
  });

  it("runs without error against the real backend prefill shape, persists applied answers, and counts applied/conflict correctly", async () => {
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));

    await act(async () => {
      await result.current.handleAutofillResult("passport", {
        prefill: [
          { key: "employee_personal_firstName", value: "Ada", label: "First Name", confidence: 91, sourceDocumentType: "passport", targetSystem: "answer", applied: true, conflict: false },
          { key: "employee_personal_lastName", value: "Curie", label: "Last Name", confidence: 90, sourceDocumentType: "passport", targetSystem: "answer", applied: false, conflict: true },
          { key: "employer.company.fullName", value: "Acme Analytics Incorporated", label: "Company Legal Name", confidence: 81, sourceDocumentType: "passport", targetSystem: "masterData", applied: false, conflict: false },
        ],
      });
    });

    expect(result.current.statusMessage).toContain("Applied 1 field");
    expect(result.current.statusMessage).toContain("1 needs your review below");
    expect(mockSaveAnswer).toHaveBeenCalledWith("q1", {
      caseId: "case-1",
      responseId: "r1",
      answers: [{ questionKey: "employee_personal_firstName", value: "Ada" }],
    });
  });

  it("shows a clear message and does not throw when nothing matched", async () => {
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));

    await act(async () => {
      await result.current.handleAutofillResult("passport", { prefill: [] });
    });

    expect(result.current.statusMessage).toMatch(/couldn't find any matching fields/i);
    expect(mockSaveAnswer).not.toHaveBeenCalled();
  });

  it("surfaces the error message and does not crash when the upload itself failed", async () => {
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employee"));

    await act(async () => {
      await result.current.handleAutofillResult("passport", null, new Error("Unable to process the uploaded document"));
    });

    expect(result.current.statusMessage).toBe("Unable to process the uploaded document");
    expect(mockSaveAnswer).not.toHaveBeenCalled();
  });

  it("persists only new applied fields and does not clobber conflicted manual answers", async () => {
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employer"));

    await act(async () => {
      await result.current.handleAutofillResult("certified_lca_eta9035", {
        prefill: [
          { key: "employer_position_jobTitle", value: "OCR VALUE", label: "Job Title", targetSystem: "answer", applied: false, conflict: true },
          { key: "employer_position_socCode", value: "15-1252", label: "SOC Code", targetSystem: "answer", applied: true, conflict: false },
        ],
      });
    });

    expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
    expect(mockSaveAnswer.mock.calls[0][1].answers).toEqual([
      { questionKey: "employer_position_socCode", value: "15-1252" },
    ]);
  });

  it("supports object-shaped OCR prefill results by saving each non-empty visible answer", async () => {
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employer"));

    await act(async () => {
      await result.current.handleAutofillResult("certified_lca_eta9035", {
        prefill: {
          employer_position_jobTitle: "SOFTWARE ENGINEER",
          employer_position_socCode: "15-1252",
          missing_question_key: "ignored",
        },
      });
    });

    expect(mockSaveAnswer.mock.calls[0][1].answers).toEqual([
      { questionKey: "employer_position_jobTitle", value: "SOFTWARE ENGINEER" },
      { questionKey: "employer_position_socCode", value: "15-1252" },
    ]);
  });
});
