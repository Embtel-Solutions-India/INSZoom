import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(() => { cleanup(); });

// The employer's view of an INVITED employee: real progress on the card, a read-only way in, and the "grant access again" popup that saves
// the employer's progress first. Server calls are faked at services/api.js.
const listCaseChecklists = vi.fn();
vi.mock("../../services/api", () => ({
  casesApi: { setEmployeeDataEntryMode: vi.fn(), resendEmployeeInvite: vi.fn(), removeEmployee: vi.fn(), employeeVisaOptions: vi.fn(), addEmployeeSlot: vi.fn() },
  questionnairesApi: { listCaseChecklists: (...args) => listCaseChecklists(...args), viewAnswerFile: vi.fn() },
}));

import EmployeeDashboard from "./EmployeeDashboard";
import GrantAccessModal from "./GrantAccessModal";

const checklist = (overrides = {}) => ({
  targetRole: "employee",
  status: "in_progress",
  progress: { percent: 47, answeredTotal: 14, totalQuestions: 30 },
  documentProgress: { percent: 56, answeredTotal: 5, totalQuestions: 9 },
  textProgress: { percent: 43, answeredTotal: 9, totalQuestions: 21 },
  ...overrides,
});

const invitedChild = { _id: "c1", caseNumber: "B1-A", visaType: "H-1B", clientName: "Ana Ruiz", clientEmail: "ana@example.com", employeeDataEntryMode: "invite", status: "active" };

function renderDashboard(child, extra = {}) {
  return render(
    <EmployeeDashboard principalId="p1" children={[child]} dataEntryMode="fill_self" targetRole="employee" defaultVisaType="H-1B" onOpen={extra.onOpen || vi.fn()} onChanged={vi.fn()} onGrantAccess={extra.onGrantAccess || vi.fn()} />
  );
}

describe("employee card of an INVITED employee", () => {
  it("shows the employee's real document and information percentages (read from the server, not guessed)", async () => {
    listCaseChecklists.mockResolvedValue({ checklists: [checklist()] });
    renderDashboard(invitedChild);
    await waitFor(() => expect(screen.getByTestId("employee-progress")).toBeTruthy());
    expect(listCaseChecklists).toHaveBeenCalledWith("c1");
    const bars = screen.getByTestId("employee-progress").textContent;
    expect(screen.getByRole("progressbar", { name: "Documents" }).getAttribute("aria-valuenow")).toBe("56");
    expect(bars).toContain("56%");
    expect(bars).toContain("5 of 9");
    expect(screen.getByRole("progressbar", { name: "Information" }).getAttribute("aria-valuenow")).toBe("43");
    expect(bars).toContain("43%");
    expect(bars).toContain("9 of 21");
  });

  it("a started employee is 'In Progress'; opening the card's main button is the READ ONLY view", async () => {
    listCaseChecklists.mockResolvedValue({ checklists: [checklist()] });
    const onOpen = vi.fn();
    renderDashboard(invitedChild, { onOpen });
    await waitFor(() => expect(screen.getByText("In Progress")).toBeTruthy());
    expect(screen.getByText("Read only")).toBeTruthy();
    fireEvent.click(screen.getByText(/View what Ana Ruiz filled in/));
    expect(onOpen).toHaveBeenCalledWith("c1", { readOnly: true });
  });

  it("an invited employee who has not started yet still shows 0% (no invented numbers) and 'Invited'", async () => {
    listCaseChecklists.mockResolvedValue({ checklists: [checklist({ progress: { percent: 0, answeredTotal: 0, totalQuestions: 30 }, documentProgress: { percent: 0, answeredTotal: 0, totalQuestions: 9 }, textProgress: { percent: 0, answeredTotal: 0, totalQuestions: 21 } })] });
    renderDashboard(invitedChild);
    await waitFor(() => expect(screen.getByTestId("employee-progress").textContent).toContain("0 of 9"));
    expect(screen.getByRole("progressbar", { name: "Documents" }).getAttribute("aria-valuenow")).toBe("0");
    expect(screen.getByText("Invited")).toBeTruthy();
  });

  it("a failing progress read never breaks the card (no bars, the buttons still work)", async () => {
    listCaseChecklists.mockRejectedValue(new Error("403"));
    renderDashboard(invitedChild);
    await waitFor(() => expect(listCaseChecklists).toHaveBeenCalled());
    expect(screen.queryByTestId("employee-progress")).toBeNull();
    expect(screen.getByText(/View what Ana Ruiz filled in/)).toBeTruthy();
  });
});

describe("employee card after the employer took the information back", () => {
  it("offers to grant access to the SAME employee again", async () => {
    listCaseChecklists.mockResolvedValue({ checklists: [checklist()] });
    const onGrantAccess = vi.fn();
    const takenBack = { ...invitedChild, employeeDataEntryMode: "fill_self" };
    renderDashboard(takenBack, { onGrantAccess });
    const button = await screen.findByText(/Grant access to Ana Ruiz again/);
    fireEvent.click(button);
    expect(onGrantAccess).toHaveBeenCalledWith(expect.objectContaining({ _id: "c1", clientEmail: "ana@example.com" }));
  });
});

describe("confirmations on the Employees dashboard are themed dialogs, never the browser's box", () => {
  it("withdrawing an employee asks first in a centred dialog and only then calls the API", async () => {
    listCaseChecklists.mockResolvedValue({ checklists: [checklist()] });
    const native = vi.spyOn(window, "confirm");
    const api = await import("../../services/api");
    api.casesApi.removeEmployee.mockResolvedValue({ success: true });
    renderDashboard(invitedChild);
    fireEvent.click(await screen.findByLabelText("Employee workflow options"));
    fireEvent.click(screen.getByText("Withdraw"));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog.textContent).toContain("Withdraw Ana Ruiz?");
    expect(api.casesApi.removeEmployee).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByText("Withdraw").pop());
    await waitFor(() => expect(api.casesApi.removeEmployee).toHaveBeenCalledWith("c1"));
    expect(native).not.toHaveBeenCalled();
  });

  it("'I'll fill this myself instead' on an invited card asks in the dialog; Cancel leaves everything as it was", async () => {
    listCaseChecklists.mockResolvedValue({ checklists: [checklist()] });
    const api = await import("../../services/api");
    renderDashboard(invitedChild);
    fireEvent.click(await screen.findByText("I'll fill this myself instead"));
    expect((await screen.findByRole("alertdialog")).textContent).toContain("Their invitation will be cancelled");
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.casesApi.setEmployeeDataEntryMode).not.toHaveBeenCalled();
  });
});

describe("GrantAccessModal", () => {
  it("saves the employer's progress FIRST, then grants access", async () => {
    const order = [];
    const beforeGrant = vi.fn(async () => { order.push("save"); });
    const onGrant = vi.fn(async () => { order.push("grant"); });
    render(<GrantAccessModal employeeName="Ana Ruiz" employeeEmail="ana@example.com" returning beforeGrant={beforeGrant} onGrant={onGrant} onClose={vi.fn()} />);
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Grant access to Ana Ruiz again\?/)).toBeTruthy();
    fireEvent.click(screen.getByText("Save progress & grant access"));
    await waitFor(() => expect(onGrant).toHaveBeenCalledWith({ name: "Ana Ruiz", email: "ana@example.com" }));
    expect(order).toEqual(["save", "grant"]);
  });

  it("does NOT grant access when the progress could not be saved, and says so", async () => {
    const onGrant = vi.fn();
    render(<GrantAccessModal employeeName="Ana Ruiz" employeeEmail="ana@example.com" returning beforeGrant={async () => { throw new Error("network down"); }} onGrant={onGrant} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Save progress & grant access"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("could not be saved");
    expect(alert.textContent).toContain("network down");
    expect(onGrant).not.toHaveBeenCalled();
  });

  it("keeps the saved progress message when the grant itself fails", async () => {
    render(<GrantAccessModal employeeName="Ana Ruiz" employeeEmail="ana@example.com" beforeGrant={async () => {}} onGrant={async () => { throw new Error("email in use"); }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Save progress & grant access"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("email in use");
    expect(alert.textContent).toContain("Your progress has been saved");
  });

  it("asks for a name and email when the employee is not known yet, and refuses to continue without them", async () => {
    const onGrant = vi.fn();
    render(<GrantAccessModal onGrant={onGrant} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("Save progress & grant access"));
    expect((await screen.findByRole("alert")).textContent).toContain("Enter the employee's name and email");
    expect(onGrant).not.toHaveBeenCalled();
    fireEvent.change(screen.getByPlaceholderText("Employee full name"), { target: { value: "Bo Lee" } });
    fireEvent.change(screen.getByPlaceholderText("Employee email address"), { target: { value: "bo@example.com" } });
    fireEvent.click(screen.getByText("Save progress & grant access"));
    await waitFor(() => expect(onGrant).toHaveBeenCalledWith({ name: "Bo Lee", email: "bo@example.com" }));
  });

  it("Cancel closes it without saving or granting", () => {
    const onClose = vi.fn(); const beforeGrant = vi.fn(); const onGrant = vi.fn();
    render(<GrantAccessModal employeeName="Ana" employeeEmail="a@b.co" beforeGrant={beforeGrant} onGrant={onGrant} onClose={onClose} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(beforeGrant).not.toHaveBeenCalled();
    expect(onGrant).not.toHaveBeenCalled();
  });
});
