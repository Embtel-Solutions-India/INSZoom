import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Explicit cleanup rather than relying purely on RTL's auto-cleanup
// detection - stacking un-unmounted component/React Query trees across this
// file's 8 tests was the source of an intermittent full-suite-only flake
// (isolated single-test runs never reproduced it; tests slowed down and
// occasionally exceeded waitFor's default timeout as more trees piled up).
afterEach(() => {
  cleanup();
});

// FIX: Documents.jsx data-loss/autosave/redirect/load-in-halves bug fixes.
// Real hooks (useQuestionnaireAnswers, useCaseQuestionnaire,
// useDocumentChecklist, useCaseDocumentChecklist, useCaseChecklists) run
// unmocked against a small in-memory fake "server" behind services/api.js -
// so unmount+remount (AC1/AC7/AC-S2) is a real persistence test, not a
// re-render of already-in-memory state. Uses fireEvent (not
// @testing-library/user-event, not a dependency of this repo) - the plain
// text inputs here fire a single onChange(event.target.value) per
// QuestionInput.jsx, so fireEvent.change is equivalent for these assertions.
vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

let mockUser;
let server;

function makeServer() {
  const employeeQuestions = [
    { _id: "q1", key: "employee_personal_firstName", label: "First name", type: "text", sectionKey: "personal", order: 1, required: true, questionnaire: "quest-employee" },
    { _id: "q2", key: "employee_personal_lastName", label: "Last name", type: "text", sectionKey: "personal", order: 2, required: true, questionnaire: "quest-employee" },
    { _id: "q3", key: "employee_personal_dateOfBirth", label: "Date of birth", type: "date", sectionKey: "personal", order: 3, required: false, questionnaire: "quest-employee" },
    { _id: "q4", key: "employee_personal_countryOfBirth", label: "Country of birth", type: "text", sectionKey: "personal", order: 4, required: false, questionnaire: "quest-employee" },
    { _id: "q5", key: "employee_education_highestLevel", label: "Highest education", type: "text", sectionKey: "education", order: 1, required: false, questionnaire: "quest-employee" },
    { _id: "q6", key: "employee_education_majorFieldOfStudy", label: "Field of study", type: "text", sectionKey: "education", order: 2, required: false, questionnaire: "quest-employee" },
    { _id: "q7", key: "employee_education_usInstitutionName", label: "Institution", type: "text", sectionKey: "education", order: 3, required: false, questionnaire: "quest-employee" },
    { _id: "q8", key: "employee_immigrationStatus_i94Number", label: "I-94 number", type: "text", sectionKey: "status", order: 1, required: false, questionnaire: "quest-employee" },
    { _id: "q9", key: "employee_immigrationStatus_currentVisaStatus", label: "Current visa status", type: "text", sectionKey: "status", order: 2, required: false, questionnaire: "quest-employee" },
    { _id: "q10", key: "employee_personal_currentUsAddress_street", label: "Street", type: "text", sectionKey: "status", order: 3, required: false, questionnaire: "quest-employee" },
  ];
  const employeeQuestionnaire = {
    _id: "quest-employee",
    title: "H-1B Employee Checklist",
    sections: [
      { key: "personal", title: "Personal", order: 1 },
      { key: "education", title: "Education", order: 2 },
      { key: "status", title: "Status", order: 3 },
    ],
  };
  // Distinct fields/labels from the employee questionnaire (Bug C/D's
  // employer-then-employee sequencing needs the two to be genuinely
  // different people's data, not colliding on identical labels/keys).
  const employerQuestions = [
    { _id: "eq1", key: "employer_company_fullName", label: "Company legal name", type: "text", sectionKey: "company", order: 1, required: true, questionnaire: "quest-employer" },
    { _id: "eq2", key: "employer_position_jobTitle", label: "Job title", type: "text", sectionKey: "company", order: 2, required: true, questionnaire: "quest-employer" },
  ];
  const employerQuestionnaire = {
    _id: "quest-employer",
    title: "H-1B Employer Checklist",
    sections: [{ key: "company", title: "Company", order: 1 }],
  };
  const emptyQuestionnaire = { _id: "quest-empty", title: "Empty", sections: [] };

  let answers = new Map(); // questionKey -> {value}
  let documents = [];
  let docSeq = 0;
  let checklists = []; // set via .checklists on the returned server for employer-sponsored scenarios
  const saveAnswerCalls = [];
  const submitCalls = [];
  const caseRecord = {
    _id: "case-1",
    visaType: "H-1B",
    employerEmployeeWorkflow: {},
    questionnaireData: { masterData: {} },
  };

  function forRole(targetRole) {
    if (targetRole === "employer") return { questionnaire: employerQuestionnaire, questions: employerQuestions };
    if (targetRole === "business_plan") return { questionnaire: emptyQuestionnaire, questions: [] };
    return { questionnaire: employeeQuestionnaire, questions: employeeQuestions };
  }

  return {
    caseRecord,
    saveAnswerCalls,
    submitCalls,
    getDocuments: () => documents,
    getAnswers: () => Object.fromEntries(answers),
    setChecklists: (list) => { checklists = list; },
    api: {
      casesApi: {
        my: async () => caseRecord,
        workflow: async () => ({ success: true }),
      },
      profileApi: {
        get: async () => ({}),
        submitIntake: async () => ({ success: true }),
        getIntake: async () => ({ data: {} }),
        saveIntake: async () => ({ success: true }),
      },
      employmentWorkflowApi: {
        me: async () => ({ cases: [caseRecord] }),
        submit: async (caseId, target) => {
          submitCalls.push(target);
          if (target === "employer") { caseRecord.employerEmployeeWorkflow.employerStatus = "submitted"; }
          else { caseRecord.employerEmployeeWorkflow.employeeStatus = "submitted"; }
          return { success: true, case: caseRecord };
        },
        saveEmployeeQuestionnaire: async () => ({ success: true }),
        inviteEmployee: async () => ({ success: true }),
        resendEmployeeInvite: async () => ({ success: true }),
      },
      familyWorkflowApi: { submit: async () => ({ success: true }) },
      questionnairesApi: {
        getForCase: async (caseId, params = {}) => {
          const { questionnaire, questions } = forRole(params.targetRole);
          return {
            data: {
              questionnaire,
              documentQuestions: [],
              fieldQuestions: questions,
              answers: questions
                .filter((q) => answers.has(q.key))
                .map((q) => ({ questionKey: q.key, value: answers.get(q.key).value, _id: `ans-${q.key}` })),
              responseId: `response-${params.targetRole || "default"}`,
              progress: { completionPercentage: 0 },
            },
          };
        },
        // Documents.jsx routes "Submit case" to employmentWorkflowApi.submit
        // only when visibleChecklists (sourced from here) is non-empty - an
        // empty list falls through to the plain-individual-case submit path
        // instead. Defaults to none (matches a plain individual case); the
        // employer-sponsored test opts in via server.setChecklists(...).
        listCaseChecklists: async () => ({ data: { checklists } }),
        saveAnswer: async (id, payload) => {
          saveAnswerCalls.push(payload);
          const items = payload.answers || (payload.questionKey ? [{ questionKey: payload.questionKey, value: payload.value }] : []);
          items.forEach(({ questionKey, value }) => answers.set(questionKey, { value }));
          return { success: true, data: { completion: { percent: 0 }, responseId: payload.responseId } };
        },
        saveFileAnswer: async () => ({ success: true, data: {} }),
      },
      documentsApi: {
        list: async () => documents,
        uploadResumable: async (file, category, documentType) => {
          docSeq += 1;
          const doc = { _id: `doc-${docSeq}`, documentType, originalName: file.name };
          documents = [...documents, doc];
          return { document: doc };
        },
        remove: async (docId) => { documents = documents.filter((d) => d._id !== docId); },
      },
    },
  };
}

vi.mock("../../services/api", () => ({
  get casesApi() { return server.api.casesApi; },
  get profileApi() { return server.api.profileApi; },
  get employmentWorkflowApi() { return server.api.employmentWorkflowApi; },
  get familyWorkflowApi() { return server.api.familyWorkflowApi; },
  get questionnairesApi() { return server.api.questionnairesApi; },
  get documentsApi() { return server.api.documentsApi; },
}));

const { default: Documents } = await import("./Documents");

function renderDocuments() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnMount: true, refetchOnWindowFocus: false, refetchOnReconnect: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/dashboard/documents"]}>
        <Routes>
          <Route path="/dashboard/documents" element={<Documents />} />
          <Route path="/dashboard" element={<div data-testid="dashboard-page">DASHBOARD</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

// ChecklistItemRow's <label htmlFor> targets a wrapping <div>, not the
// <input> itself (a pre-existing gap in that shared component, outside this
// fix's file allowlist) - so getByLabelText can't associate them, and label
// TEXT isn't reliably unique either (e.g. a mobile section-jump <option> or
// another role's section can coincidentally share substring matches). The
// one fully deterministic handle is the item's own DOM id, built by
// buildRoleSections as `q-${prefix}-${questionKey}` (prefix is "x" for the
// legacy/single-role path, or the roleGroup - "employer"/"business_plan"/
// "employee" - for the new architecture). Query by that id directly.
function findFieldByKey(prefix, questionKey) {
  const row = document.querySelector(`#q-${prefix}-${questionKey}`);
  if (!row) throw new Error(`No item rendered for q-${prefix}-${questionKey}`);
  const input = row.querySelector("input, textarea, select");
  if (!input) throw new Error(`No input found inside item q-${prefix}-${questionKey}`);
  return input;
}

function setFieldByKey(prefix, questionKey, value) {
  const input = findFieldByKey(prefix, questionKey);
  fireEvent.change(input, { target: { value } });
  return input;
}

beforeEach(() => {
  mockUser = { _id: "user-1", role: "client", applicantType: "individual" };
  server = makeServer();
});

describe("Documents.jsx — data persistence & autosave removal (Bug A/B, AC2, AC-S1/S4)", () => {
  it("AC2 — editing a field fires zero save calls; Save progress fires exactly one batched save", async () => {
    renderDocuments();
    await screen.findByText(/first name/i);
    setFieldByKey("x", "employee_personal_firstName", "Ada");
    expect(server.saveAnswerCalls.length).toBe(0);

    fireEvent.click(screen.getAllByRole("button", { name: /save progress/i })[0]);
    await waitFor(() => expect(server.saveAnswerCalls.length).toBe(1));
    expect(server.saveAnswerCalls[0].answers.some((entry) => entry.questionKey === "employee_personal_firstName" && entry.value === "Ada")).toBe(true);
  });

  it("AC-S1/AC-S4 — Save progress persists partial answers without submitting; case status unchanged; Submit stays disabled", async () => {
    renderDocuments();
    await screen.findByText(/first name/i);
    setFieldByKey("x", "employee_personal_firstName", "Ada");

    const submitButton = screen.getAllByRole("button", { name: /submit case/i })[0];
    expect(submitButton.disabled).toBe(true); // required lastName still missing

    const saveButton = screen.getAllByRole("button", { name: /save progress/i })[0];
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);

    await waitFor(() => expect(server.getAnswers().employee_personal_firstName?.value).toBe("Ada"));
    expect(server.submitCalls.length).toBe(0);
    expect(server.caseRecord.employerEmployeeWorkflow.employerStatus).toBeUndefined();
    expect(screen.getAllByRole("button", { name: /submit case/i })[0].disabled).toBe(true);
  });
});

describe("Documents.jsx — no data loss across reload (AC1/AC7/AC-S2)", () => {
  it("fields saved via Save progress persist across unmount + remount", async () => {
    const { unmount } = renderDocuments();
    await screen.findByText(/first name/i);

    const fields = [
      ["employee_personal_firstName", "Ada"],
      ["employee_personal_lastName", "Lovelace"],
      ["employee_personal_countryOfBirth", "United Kingdom"],
      ["employee_education_highestLevel", "Master's"],
      ["employee_education_majorFieldOfStudy", "Computer Science"],
      ["employee_education_usInstitutionName", "Stanford"],
      ["employee_immigrationStatus_i94Number", "11223344556"],
      ["employee_immigrationStatus_currentVisaStatus", "F-1"],
      ["employee_personal_currentUsAddress_street", "221B Baker Street"],
    ];
    fields.forEach(([key, value]) => setFieldByKey("x", key, value));

    fireEvent.click(screen.getAllByRole("button", { name: /save progress/i })[0]);
    await waitFor(() => expect(Object.keys(server.getAnswers()).length).toBeGreaterThanOrEqual(9));

    unmount();
    renderDocuments();
    await screen.findByText(/first name/i);

    for (const [key, value] of fields) {
      await waitFor(() => expect(findFieldByKey("x", key).value).toBe(value));
    }
  });
});

describe("Documents.jsx — role-aware navigation, no premature redirect (Bug C, AC4)", () => {
  it("submitting the employer side of an employer-sponsored case does not navigate away while an inline employee section is pending", async () => {
    mockUser = { _id: "employer-1", role: "employer" };
    server = makeServer();
    server.caseRecord.questionnaireData.masterData.employeeQuestionnaireAssignment = { mode: "employer_completes" };
    server.setChecklists([
      { referenceId: "ref-employer", targetRole: "employer", title: "H-1B Employer Checklist", status: "pending" },
      { referenceId: "ref-employee", targetRole: "employee", title: "H-1B Employee Checklist", status: "pending" },
    ]);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0, gcTime: 0, refetchOnMount: true, refetchOnWindowFocus: false, refetchOnReconnect: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/dashboard/documents/case-1"]}>
          <Routes>
            <Route path="/dashboard/documents/:caseId" element={<Documents />} />
            <Route path="/dashboard" element={<div data-testid="dashboard-page">DASHBOARD</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByText(/company legal name/i, {}, { timeout: 5000 });
    setFieldByKey("employer", "employer_company_fullName", "Acme Analytics Inc");
    setFieldByKey("employer", "employer_position_jobTitle", "Software Engineer");

    const submitButton = screen.getAllByRole("button", { name: /submit case/i })[0];
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    fireEvent.click(submitButton);

    await waitFor(() => expect(server.submitCalls).toContain("employer"));
    expect(screen.queryByTestId("dashboard-page")).toBeNull();
    expect(server.submitCalls).not.toContain("employee");
  });

  it("submitting an individual (non-employer-shaped) case navigates to /dashboard", async () => {
    renderDocuments();
    await screen.findByText(/first name/i);
    setFieldByKey("x", "employee_personal_firstName", "Ada");
    setFieldByKey("x", "employee_personal_lastName", "Lovelace");

    const submitButton = screen.getAllByRole("button", { name: /submit case/i })[0];
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    fireEvent.click(submitButton);

    await waitFor(() => expect(screen.queryByTestId("dashboard-page")).not.toBeNull());
  });
});

describe("Documents.jsx — Save progress addendum (AC-S3, AC-S5, AC-S6)", () => {
  it("AC-S3 — Save progress and Submit send the identical answer-persistence payload for the same inputs", async () => {
    // Save progress run.
    renderDocuments();
    await screen.findByText(/first name/i);
    setFieldByKey("x", "employee_personal_firstName", "Ada");
    setFieldByKey("x", "employee_personal_lastName", "Lovelace");
    fireEvent.click(screen.getAllByRole("button", { name: /save progress/i })[0]);
    await waitFor(() => expect(server.saveAnswerCalls.length).toBe(1));
    const saveProgressPayload = server.saveAnswerCalls[0].answers.slice().sort((a, b) => a.questionKey.localeCompare(b.questionKey));

    // Independent Submit run, same inputs, fresh server/render.
    server = makeServer();
    renderDocuments();
    await screen.findByText(/first name/i);
    setFieldByKey("x", "employee_personal_firstName", "Ada");
    setFieldByKey("x", "employee_personal_lastName", "Lovelace");
    const submitButton = screen.getAllByRole("button", { name: /submit case/i })[0];
    await waitFor(() => expect(submitButton.disabled).toBe(false));
    fireEvent.click(submitButton);
    await waitFor(() => expect(server.saveAnswerCalls.length).toBe(1));
    const submitPayload = server.saveAnswerCalls[0].answers.slice().sort((a, b) => a.questionKey.localeCompare(b.questionKey));

    expect(submitPayload).toEqual(saveProgressPayload);
  });

  it("AC-S5 — dirty uncommitted answers trigger the beforeunload warning; a route change (back button) is blocked; Save progress clears the guard", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderDocuments();
    await screen.findByText(/first name/i);
    setFieldByKey("x", "employee_personal_firstName", "Ada");

    const beforeUnloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnloadEvent);
    expect(beforeUnloadEvent.defaultPrevented).toBe(true);

    const popStateEvent = new Event("popstate");
    window.dispatchEvent(popStateEvent);
    expect(confirmSpy).toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button", { name: /save progress/i })[0]);
    await waitFor(() => expect(server.saveAnswerCalls.length).toBe(1));

    const afterSaveEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterSaveEvent);
    expect(afterSaveEvent.defaultPrevented).toBe(false);

    confirmSpy.mockRestore();
  });

  it("AC-S6 — Save progress transitions idle -> Saving... -> Saved(timestamp); both buttons disable while a save is running", async () => {
    let resolveSave;
    renderDocuments();
    await screen.findByText(/first name/i);
    setFieldByKey("x", "employee_personal_firstName", "Ada");

    const originalSaveAnswer = server.api.questionnairesApi.saveAnswer;
    server.api.questionnairesApi.saveAnswer = (id, payload) => new Promise((resolve) => {
      resolveSave = () => resolve(originalSaveAnswer(id, payload));
    });

    const saveButton = screen.getAllByRole("button", { name: /save progress/i })[0];
    expect(saveButton.textContent).toBe("Save progress");

    fireEvent.click(saveButton);
    await waitFor(() => expect(screen.getAllByRole("button", { name: /saving/i })[0]).toBeTruthy());
    expect(screen.getAllByRole("button", { name: /saving/i })[0].disabled).toBe(true);
    expect(screen.getAllByRole("button", { name: /submit case/i })[0].disabled).toBe(true);

    resolveSave();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /save progress/i })[0]).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/^saved/i)).toBeTruthy());
  });
});
