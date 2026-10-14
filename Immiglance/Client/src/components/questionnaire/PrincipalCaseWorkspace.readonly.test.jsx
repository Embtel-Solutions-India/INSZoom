import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(() => { cleanup(); });

// Employer -> invited employee: the READ ONLY view (banner, nothing editable, no save/submit), the switch back to "employer fills" with the
// same screen turning editable, and the "grant access" popup saving the employer's progress before the hand-over.
const api = vi.hoisted(() => ({
  getRelated: vi.fn(),
  setEmployeeDataEntryMode: vi.fn(),
  listCaseChecklists: vi.fn(),
}));
vi.mock("../../services/api", () => ({
  casesApi: {
    getRelated: (...a) => api.getRelated(...a),
    setEmployeeDataEntryMode: (...a) => api.setEmployeeDataEntryMode(...a),
    resendEmployeeInvite: vi.fn(), removeEmployee: vi.fn(), employeeVisaOptions: vi.fn(), addEmployeeSlot: vi.fn(),
  },
  questionnairesApi: { listCaseChecklists: (...a) => api.listCaseChecklists(...a), viewAnswerFile: vi.fn(), submit: vi.fn() },
}));

const qaCalls = [];
const commitAll = vi.fn(async () => ({}));
const refetch = vi.fn(async () => {});
vi.mock("../../hooks/useQuestionnaireAnswers", () => ({
  default: (caseId, role, options = {}) => {
    qaCalls.push({ caseId, role, options });
    const loaded = Boolean(caseId);
    return {
      questionnaire: loaded ? { _id: "qn1", title: "H-1B Employee Checklist" } : null,
      initialLoading: false, error: null, notReleased: false,
      sections: loaded ? [{ key: "personal", title: "Personal" }] : [],
      questionsBySection: new Map(loaded ? [["personal", [{ _id: "q1", key: "first_name", label: "First name", type: "text", required: true }]]] : []),
      answers: loaded ? { first_name: "Ana" } : {},
      answerByKey: new Map(), prefillMeta: {}, savingKey: "", saveAnswer: vi.fn(), saveFiles: vi.fn(), removeFile: vi.fn(),
      commitAll, handleAutofillResult: vi.fn(), responseId: "r1", questionnaireId: "qn1", missingRequiredCount: 0,
      dirty: false, saveState: "idle", lastSavedAt: "", refetch,
    };
  },
}));
vi.mock("./CaseRoleChecklist", () => ({ CaseRoleChecklistView: () => <div>employer checklist</div> }));
vi.mock("./DataEntryModeModal", () => ({ default: () => null }));

import PrincipalCaseWorkspace from "./PrincipalCaseWorkspace";

const invitedChild = { _id: "c1", caseNumber: "B1-A", visaType: "H-1B", clientName: "Ana Ruiz", clientEmail: "ana@example.com", employeeDataEntryMode: "invite", status: "active" };
const principal = { _id: "p1", visaType: "H-1B", caseStructure: "employer_employee", dataEntryMode: "fill_self" };

beforeEach(() => {
  qaCalls.length = 0;
  commitAll.mockClear();
  api.getRelated.mockReset().mockResolvedValue({ childCases: [invitedChild] });
  api.setEmployeeDataEntryMode.mockReset().mockResolvedValue({ success: true, message: "ok" });
  api.listCaseChecklists.mockReset().mockResolvedValue({ checklists: [{ targetRole: "employee", status: "in_progress", progress: { percent: 40, answeredTotal: 4, totalQuestions: 10 }, documentProgress: { percent: 50, answeredTotal: 1, totalQuestions: 2 }, textProgress: { percent: 38, answeredTotal: 3, totalQuestions: 8 } }] });
});

describe("read-only view of an invited employee", () => {
  it("opens with a 'Read only view' banner, loads the file WITHOUT write ability, polls, and shows no Save progress / Submit", async () => {
    render(<PrincipalCaseWorkspace activeCase={principal} />);
    fireEvent.click(await screen.findByText(/View what Ana Ruiz filled in/));
    expect(await screen.findByTestId("read-only-banner")).toBeTruthy();
    expect(screen.getAllByText(/Read only view/i).length).toBeGreaterThan(0);
    const open = qaCalls.filter((call) => call.caseId === "c1").pop();
    expect(open.options.disabled).toBe(true);
    expect(open.options.pollMs).toBeGreaterThan(0);
    expect(screen.queryByText("Save progress")).toBeNull();
    expect(screen.queryByText("Grant access to employee")).toBeNull();
    expect(screen.queryByText("Submit")).toBeNull();
    // the employee's answer is displayed but cannot be edited
    fireEvent.click(screen.getByText("Continue"));
    const input = await screen.findByDisplayValue("Ana");
    expect(input.disabled).toBe(true);
  });

  it("'I'll fill this myself instead' withdraws the access and the SAME screen becomes editable (nothing is lost)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<PrincipalCaseWorkspace activeCase={principal} />);
    fireEvent.click(await screen.findByText(/View what Ana Ruiz filled in/));
    fireEvent.click(await screen.findByText("I'll fill this myself instead", { selector: "[data-testid='read-only-banner'] button" }));
    await waitFor(() => expect(api.setEmployeeDataEntryMode).toHaveBeenCalledWith("p1", "c1", { mode: "fill_self" }));
    await waitFor(() => expect(screen.queryByTestId("read-only-banner")).toBeNull());
    expect(screen.getByText("Save progress")).toBeTruthy();
    expect(screen.getByText("Grant access to employee")).toBeTruthy();
    const open = qaCalls.filter((call) => call.caseId === "c1").pop();
    expect(open.options.disabled).toBe(false);
  });

  it("a declined confirmation changes nothing", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<PrincipalCaseWorkspace activeCase={principal} />);
    fireEvent.click(await screen.findByText(/View what Ana Ruiz filled in/));
    fireEvent.click(await screen.findByText("I'll fill this myself instead", { selector: "[data-testid='read-only-banner'] button" }));
    expect(api.setEmployeeDataEntryMode).not.toHaveBeenCalled();
    expect(screen.getByTestId("read-only-banner")).toBeTruthy();
  });
});

describe("granting access again from the employee's own form", () => {
  it("saves the employer's progress, THEN hands the information back to the same employee", async () => {
    api.getRelated.mockResolvedValue({ childCases: [{ ...invitedChild, employeeDataEntryMode: "fill_self" }] });
    render(<PrincipalCaseWorkspace activeCase={principal} />);
    fireEvent.click(await screen.findByText(/^(Continue|Review|Fill Information)$/));
    fireEvent.click(await screen.findByText("Grant access to employee"));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Grant access to Ana Ruiz again\?/)).toBeTruthy();
    fireEvent.click(screen.getByText("Save progress & grant access"));
    await waitFor(() => expect(api.setEmployeeDataEntryMode).toHaveBeenCalledWith("p1", "c1", { mode: "invite", employeeName: "Ana Ruiz", employeeEmail: "ana@example.com" }));
    expect(commitAll).toHaveBeenCalledTimes(1);
    expect(commitAll.mock.invocationCallOrder[0]).toBeLessThan(api.setEmployeeDataEntryMode.mock.invocationCallOrder[0]);
  });

  it("a failed save stops the grant: the information is never handed over", async () => {
    commitAll.mockRejectedValueOnce(new Error("offline"));
    api.getRelated.mockResolvedValue({ childCases: [{ ...invitedChild, employeeDataEntryMode: "fill_self" }] });
    render(<PrincipalCaseWorkspace activeCase={principal} />);
    fireEvent.click(await screen.findByText(/^(Continue|Review|Fill Information)$/));
    fireEvent.click(await screen.findByText("Grant access to employee"));
    fireEvent.click(await screen.findByText("Save progress & grant access"));
    expect((await screen.findByRole("alert")).textContent).toContain("could not be saved");
    expect(api.setEmployeeDataEntryMode).not.toHaveBeenCalled();
  });
});
