import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

afterEach(() => { cleanup(); });
vi.mock("../../services/api", () => ({ questionnairesApi: { submit: vi.fn(), viewAnswerFile: vi.fn() } }));

import EmployeePacketStepper from "./EmployeePacketStepper";
import { REQUESTED_SECTION_KEY } from "../../utils/questionnaireEngine";

// A requested item is NOT a page of its own: it is the FIRST item on the same page - the first document on the Documents step, the first
// group on the Information step - right above the other items.
const meta = { requestedByStaff: { requestId: "r1", note: "clear scan" } };
const degree = { _id: "d2", key: "degree", label: "Academic Certificates with transcripts", type: "file", required: true, metadata: meta };
const salary = { _id: "f2", key: "salary", label: "Salary as per offer letter", type: "text", required: true, metadata: meta };
const first = { _id: "f1", key: "first_name", label: "First name", type: "text", sectionKey: "personal" };
const passport = { _id: "d1", key: "passport", label: "Passport copy", type: "file", sectionKey: "personal" };

function qa({ withRequest }) {
  const sections = [
    ...(withRequest ? [{ key: REQUESTED_SECTION_KEY, title: "Requested by your case manager" }] : []),
    { key: "personal", title: "Personal" },
    { key: "__documents__", title: "Documents" },
  ];
  const map = new Map([["personal", [first]], ["__documents__", [passport, ...(withRequest ? [] : [degree])]]]);
  if (withRequest) map.set(REQUESTED_SECTION_KEY, [degree, salary]);
  return {
    questionnaire: { _id: "q1", title: "O-1B Employee Checklist" }, initialLoading: false, error: null, notReleased: false,
    sections, questionsBySection: map, answers: {}, answerByKey: new Map(), prefillMeta: {}, savingKey: "",
    saveAnswer: vi.fn(), saveFiles: vi.fn(), removeFile: vi.fn(), commitAll: vi.fn(), handleAutofillResult: vi.fn(),
    responseId: "r1", questionnaireId: "q1", missingRequiredCount: 2, dirty: false, saveState: "idle", lastSavedAt: "",
  };
}

const positionOf = (html, text) => html.indexOf(text);

describe("EmployeePacketStepper with requested items", () => {
  it("there is no extra step: still Documents -> Information -> Review", () => {
    render(<EmployeePacketStepper qa={qa({ withRequest: true })} caseId="c1" employeeLabel="Ana" />);
    expect(screen.queryByTestId("requested-step")).toBeNull();
    expect(screen.queryByText("Requested", { selector: "button" })).toBeNull();
    ["Documents", "Information", "Review"].forEach((label) => expect(screen.getByText(label, { selector: "button" })).toBeTruthy());
  });

  it("on the Documents step the requested document is the FIRST item, above the other documents", () => {
    const { container } = render(<EmployeePacketStepper qa={qa({ withRequest: true })} caseId="c1" employeeLabel="Ana" />);
    const html = container.innerHTML;
    expect(screen.getByText(/Academic Certificates with transcripts/)).toBeTruthy();
    expect(positionOf(html, "Academic Certificates with transcripts")).toBeLessThan(positionOf(html, "Passport copy"));
    expect(screen.queryByText("Salary as per offer letter")).toBeNull(); // text items belong to the Information step
  });

  it("on the Information step the requested text item comes first, above the other questions", () => {
    const { container } = render(<EmployeePacketStepper qa={qa({ withRequest: true })} caseId="c1" employeeLabel="Ana" />);
    fireEvent.click(screen.getByText("Continue"));
    const html = container.innerHTML;
    expect(screen.getByText(/Salary as per offer letter/)).toBeTruthy();
    // the first group (selected by default) is the requested one; the other sections follow in the side list
    expect(positionOf(html, "Requested by your case manager")).toBeLessThan(positionOf(html, "Personal"));
    expect(screen.queryByText("First name")).toBeNull();
  });

  it("a case with NO request is exactly as before", () => {
    render(<EmployeePacketStepper qa={qa({ withRequest: false })} caseId="c1" employeeLabel="Ana" />);
    expect(screen.getByText("Documents we need")).toBeTruthy();
    expect(screen.getByText(/Academic Certificates with transcripts/)).toBeTruthy();
  });
});
