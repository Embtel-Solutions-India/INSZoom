import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => { cleanup(); });
vi.mock("../../services/api", () => ({ questionnairesApi: { submit: vi.fn(), viewAnswerFile: vi.fn() } }));

import EmployeePacketStepper from "./EmployeePacketStepper";
import { REQUESTED_SECTION_KEY } from "../../utils/questionnaireEngine";

// The employee packet shows the checklist exactly as it is defined: its own sections (one tab each) in their own order, every question of a
// section - uploads included - in the checklist's order. A requested item is NOT a page of its own: the "Requested by your case manager" group
// is the FIRST section, right above the others. Then Review.
const meta = { requestedByStaff: { requestId: "r1", note: "clear scan" } };
const degree = { _id: "d2", key: "degree", label: "Academic Certificates with transcripts", type: "file", required: true, metadata: meta };
const salary = { _id: "f2", key: "salary", label: "Salary as per offer letter", type: "text", required: true, metadata: meta };
const first = { _id: "f1", key: "first_name", label: "First name", type: "text", sectionKey: "personal" };
const passport = { _id: "d1", key: "passport", label: "Passport copy", type: "file", sectionKey: "personal" };

// the shape useQuestionnaireAnswers now returns: uploads live in their own section
function qa({ withRequest }) {
  const sections = [
    ...(withRequest ? [{ key: REQUESTED_SECTION_KEY, title: "Requested by your case manager" }] : []),
    { key: "personal", title: "Personal" },
  ];
  const map = new Map([["personal", withRequest ? [first, passport] : [first, passport, degree]]]);
  if (withRequest) map.set(REQUESTED_SECTION_KEY, [degree, salary]);
  return {
    questionnaire: { _id: "q1", title: "O-1B Employee Checklist" }, initialLoading: false, error: null, notReleased: false,
    sections, questionsBySection: map, answers: {}, answerByKey: new Map(), prefillMeta: {}, savingKey: "",
    saveAnswer: vi.fn(), saveFiles: vi.fn(), removeFile: vi.fn(), commitAll: vi.fn(), handleAutofillResult: vi.fn(),
    responseId: "r1", questionnaireId: "q1", missingRequiredCount: 2, dirty: false, saveState: "idle", lastSavedAt: "",
  };
}

const positionOf = (html, text) => html.indexOf(text);

describe("EmployeePacketStepper - the checklist as defined, with requested items first", () => {
  it("two steps: the Checklist (its own sections) and Review - no separate Documents step, no extra Requested step", () => {
    render(<EmployeePacketStepper qa={qa({ withRequest: true })} caseId="c1" employeeLabel="Ana" />);
    expect(screen.queryByTestId("requested-step")).toBeNull();
    ["Checklist", "Review"].forEach((label) => expect(screen.getByText(label, { selector: "button" })).toBeTruthy());
    expect(screen.queryByText("Documents", { selector: "button" })).toBeNull();
    expect(screen.queryByText("Documents we need")).toBeNull();
  });

  it("the requested group is the FIRST section and holds the requested document and text item together", () => {
    const { container } = render(<EmployeePacketStepper qa={qa({ withRequest: true })} caseId="c1" employeeLabel="Ana" />);
    const html = container.innerHTML;
    expect(positionOf(html, "Requested by your case manager")).toBeLessThan(positionOf(html, ">Personal<"));
    expect(screen.getByText(/Academic Certificates with transcripts/)).toBeTruthy();
    expect(screen.getByText(/Salary as per offer letter/)).toBeTruthy();
    expect(screen.queryByText("First name")).toBeNull(); // another section's questions show on its own tab
  });

  it("a section shows its questions in the checklist's order, the upload inside the section it belongs to", () => {
    const { container } = render(<EmployeePacketStepper qa={qa({ withRequest: true })} caseId="c1" employeeLabel="Ana" />);
    fireEvent.click(screen.getByRole("tab", { name: "Personal" }));
    const html = container.innerHTML;
    expect(screen.getByText("First name")).toBeTruthy();
    expect(screen.getByText("Passport copy")).toBeTruthy();
    expect(positionOf(html, "First name")).toBeLessThan(positionOf(html, "Passport copy"));
  });

  it("a case with NO request shows the checklist's sections straight away", () => {
    const { container } = render(<EmployeePacketStepper qa={qa({ withRequest: false })} caseId="c1" employeeLabel="Ana" />);
    const html = container.innerHTML;
    expect(screen.queryByText("Requested by your case manager")).toBeNull();
    expect(positionOf(html, "First name")).toBeLessThan(positionOf(html, "Passport copy"));
    expect(positionOf(html, "Passport copy")).toBeLessThan(positionOf(html, "Academic Certificates with transcripts"));
  });
});
