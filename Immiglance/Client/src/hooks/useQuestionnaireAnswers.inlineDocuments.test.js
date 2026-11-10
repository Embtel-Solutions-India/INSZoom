import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

// A checklist can keep its uploads inside their own sections (questionnaire.settings.inlineDocuments, used by the L1A Documentation Checklist). Every other checklist keeps the shared
// "Documents" step. useCaseQuestionnaire is mocked (it makes a real API call on mount); the objects are stable so the hook's effects do not loop.
const state = vi.hoisted(() => ({ current: null }));
const sections = [
  { key: "us", title: "Documents from the U.S. Company", order: 1 },
  { key: "foreign", title: "Documents from the Foreign (outside U.S.) Company", order: 2 },
];
const field = { key: "us_company_website", label: "6. Company Website", type: "text", sectionKey: "us", order: 2 };
const file = { key: "us_articles", label: "1. Articles of Incorporation", type: "file", sectionKey: "us", order: 1 };
const foreignFile = { key: "foreign_lease", label: "2. Lease", type: "file", sectionKey: "foreign", order: 3 };
const empty = [];
const progress = { completionPercentage: 0 };
const refetch = vi.fn();

vi.mock("../services/api", () => ({ questionnairesApi: { saveAnswer: vi.fn() } }));
vi.mock("./useCaseQuestionnaire", () => ({
  default: () => state.current,
}));

const { default: useQuestionnaireAnswers } = await import("./useQuestionnaireAnswers");

const build = (settings) => ({
  questionnaire: { _id: settings ? "inline" : "plain", title: "Checklist", sections, settings },
  documentQuestions: [file, foreignFile],
  fieldQuestions: [field],
  hiddenQuestions: empty,
  answers: empty,
  responseId: "r1",
  progress,
  loading: false,
  error: null,
  refetch,
});

describe("useQuestionnaireAnswers - uploads inside their sections (settings.inlineDocuments)", () => {
  it("every checklist now does the same, with or without the setting: its own sections only, uploads inside them, in order", () => {
    state.current = build(undefined);
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employer"));
    expect(result.current.sections.map((section) => section.title)).toEqual(["Documents from the U.S. Company", "Documents from the Foreign (outside U.S.) Company"]);
    expect(result.current.questionsBySection.get("us").map((q) => q.key)).toEqual(["us_articles", "us_company_website"]);
    expect(result.current.questionsBySection.get("foreign").map((q) => q.key)).toEqual(["foreign_lease"]);
    expect(result.current.questionsBySection.has("__documents__")).toBe(false);
  });

  it("a question whose section the checklist does not list is never dropped: it gets a section of its own after the listed ones", () => {
    state.current = { ...build(undefined), documentQuestions: [file, foreignFile, { key: "stray_doc", label: "Other document", type: "file", sectionKey: "unlisted", order: 9 }] };
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employer"));
    expect(result.current.sections.map((section) => section.title)).toEqual(["Documents from the U.S. Company", "Documents from the Foreign (outside U.S.) Company", "Documents"]);
    expect(result.current.questionsBySection.get("unlisted").map((q) => q.key)).toEqual(["stray_doc"]);
  });

  it("with inlineDocuments the sections are exactly the checklist's own, each holding its uploads and fields in order", () => {
    state.current = build({ inlineDocuments: true });
    const { result } = renderHook(() => useQuestionnaireAnswers("case-1", "employer"));
    expect(result.current.sections.map((section) => section.title)).toEqual(["Documents from the U.S. Company", "Documents from the Foreign (outside U.S.) Company"]);
    expect(result.current.questionsBySection.get("us").map((q) => q.key)).toEqual(["us_articles", "us_company_website"]);
    expect(result.current.questionsBySection.get("foreign").map((q) => q.key)).toEqual(["foreign_lease"]);
    expect(result.current.questionsBySection.has("__documents__")).toBe(false);
  });
});
