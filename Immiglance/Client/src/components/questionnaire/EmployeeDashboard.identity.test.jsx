import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

afterEach(() => { cleanup(); });

// The employee card asks for the employee's name and email until both are known, saves them on the case (the same fields Admin shows), and then
// leaves the existing "who fills this in" choice exactly as it was. The API is faked.
const api = vi.hoisted(() => ({ setEmployeeIdentity: vi.fn(), listCaseChecklists: vi.fn() }));
vi.mock("../../services/api", () => ({
  casesApi: {
    setEmployeeIdentity: (...a) => api.setEmployeeIdentity(...a),
    setEmployeeDataEntryMode: vi.fn(), resendEmployeeInvite: vi.fn(), removeEmployee: vi.fn(),
  },
  questionnairesApi: { listCaseChecklists: (...a) => api.listCaseChecklists(...a) },
}));
vi.mock("./AddEmployeeModal", () => ({ default: () => null }));

import EmployeeDashboard from "./EmployeeDashboard";

const slot = (over = {}) => ({ _id: "c1", caseNumber: "B411-A", visaType: "L-1B", clientName: "", clientEmail: "", employeeContact: { name: "", email: "", missingName: true, missingEmail: true, complete: false }, ...over });
const renderDashboard = (children, onChanged = vi.fn()) => render(
  <EmployeeDashboard principalId="p1" children={children} dataEntryMode="fill_self" targetRole="employee" onOpen={vi.fn()} onChanged={onChanged} />,
);

beforeEach(() => {
  api.setEmployeeIdentity.mockReset().mockResolvedValue({ success: true });
  api.listCaseChecklists.mockReset().mockResolvedValue({ checklists: [] });
});

describe("Employee card: name and email", () => {
  it("asks for the name and email while either is missing, and saves them on the employee's case", async () => {
    const onChanged = vi.fn();
    renderDashboard([slot()], onChanged);
    expect(await screen.findByTestId("employee-identity-request")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Employee full name"), { target: { value: "Ana Souza" } });
    fireEvent.change(screen.getByLabelText("Employee email"), { target: { value: "ana@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(api.setEmployeeIdentity).toHaveBeenCalledWith("p1", "c1", { name: "Ana Souza", email: "ana@example.com" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("shows the name and email the team lead typed, leads with them (the case id is secondary) and stops asking", async () => {
    renderDashboard([slot({ employeeContact: { name: "Ana Souza", email: "ana@example.com", missingName: false, missingEmail: false, complete: true } })]);
    expect(await screen.findByText("Ana Souza")).toBeTruthy();
    expect(screen.getByText("ana@example.com")).toBeTruthy();
    expect(screen.getByText("B411-A")).toBeTruthy();
    expect(screen.queryByTestId("employee-identity-request")).toBeNull();
  });

  it("a server refusal (for example a duplicate email) is shown and nothing is reported as saved", async () => {
    api.setEmployeeIdentity.mockRejectedValue({ response: { data: { message: "That email is already used for another employee." } } });
    const onChanged = vi.fn();
    renderDashboard([slot()], onChanged);
    fireEvent.change(await screen.findByLabelText("Employee email"), { target: { value: "dup@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText(/already used for another employee/)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
