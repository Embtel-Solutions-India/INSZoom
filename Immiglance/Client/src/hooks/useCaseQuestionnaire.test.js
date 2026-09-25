import { describe, expect, it, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

// Bug: a file upload calls refetch() -> load(), which set `loading: true`
// identically for the very first fetch and every later background refetch -
// any render gate using `loading` (e.g. CaseRoleChecklistView) unmounted the
// already-visible questionnaire on every upload. `initialLoading` must be
// true only before the first successful fetch; `refreshing` must be true
// (and `initialLoading` false) for every fetch after that, including one
// triggered by refetch() while prior data is still present.
const mockGetForCase = vi.fn();

vi.mock("../services/api", () => ({
  questionnairesApi: {
    getForCase: (...args) => mockGetForCase(...args),
    saveAnswer: vi.fn(),
  },
}));

const { default: useCaseQuestionnaire } = await import("./useCaseQuestionnaire");

describe("useCaseQuestionnaire initialLoading vs refreshing", () => {
  it("is initialLoading on first mount, then refreshing (not initialLoading) on a later refetch", async () => {
    let resolveFirst;
    mockGetForCase.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    );

    const { result } = renderHook(() => useCaseQuestionnaire("case-1", "employee"));

    // Before the first response arrives: this is the genuine blank-screen case.
    expect(result.current.loading).toBe(true);
    expect(result.current.initialLoading).toBe(true);
    expect(result.current.refreshing).toBe(false);

    await act(async () => {
      resolveFirst({ data: { questionnaire: { _id: "q1" }, documentQuestions: [], fieldQuestions: [], answers: [], responseId: "r1" } });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.initialLoading).toBe(false);
    expect(result.current.refreshing).toBe(false);
    expect(result.current.questionnaire).toEqual({ _id: "q1" });

    // Now trigger a refetch (what saveFiles() does after a successful upload)
    // while data already exists.
    let resolveSecond;
    mockGetForCase.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSecond = resolve; })
    );

    act(() => {
      result.current.refetch();
    });

    // Mid-refetch: loading is true (so a spinner/indicator can use it), but
    // this must NOT look like initialLoading - the previously-fetched
    // questionnaire is still present and must not be unmounted.
    await waitFor(() => expect(result.current.loading).toBe(true));
    expect(result.current.initialLoading).toBe(false);
    expect(result.current.refreshing).toBe(true);
    expect(result.current.questionnaire).toEqual({ _id: "q1" });

    await act(async () => {
      resolveSecond({ data: { questionnaire: { _id: "q1" }, documentQuestions: [], fieldQuestions: [], answers: [], responseId: "r1" } });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.initialLoading).toBe(false);
    expect(result.current.refreshing).toBe(false);
  });
});
