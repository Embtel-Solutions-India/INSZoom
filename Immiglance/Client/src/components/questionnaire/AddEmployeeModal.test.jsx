import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const api = vi.hoisted(() => ({ employeeVisaOptions: vi.fn(), addEmployeeSlot: vi.fn(), setEmployeeDataEntryMode: vi.fn() }));
vi.mock("../../services/api", () => ({ casesApi: api }));

import AddEmployeeModal from "./AddEmployeeModal";

// What GET /api/cases/employee-visa-options returns: the employer-matter part of the one shared visa dropdown (same labels as the Admin portal).
const VISAS = [
  { visaType: "H-1B", label: "H-1B", subTypes: ["New H-1B", "H-1B Extension"] },
  { visaType: "L-1A", label: "L-1A", subTypes: [] },
  { visaType: "EB-2 NIW", label: "EB-2 NIW", subTypes: [] },
];

beforeEach(() => {
  api.employeeVisaOptions.mockReset().mockResolvedValue({ data: VISAS });
  api.addEmployeeSlot.mockReset().mockResolvedValue({ childCaseId: "child1" });
  api.setEmployeeDataEntryMode.mockReset().mockResolvedValue({});
});

describe("client portal Add employee - the same visa dropdown as Admin", () => {
  it("lists the shared visa list in the shared dropdown, with the server's labels", async () => {
    render(<AddEmployeeModal principalId="p1" onClose={() => {}} onAdded={() => {}} />);
    fireEvent.click(screen.getByLabelText("Visa"));
    await waitFor(() => expect(screen.getByRole("option", { name: "H-1B" })).toBeTruthy());
    expect(screen.getByRole("option", { name: "L-1A" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "EB-2 NIW" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Specialty Occupation/ })).toBeNull(); // not this portal's old, different wording
  });

  it("the list can be searched, like the Admin dropdown", async () => {
    render(<AddEmployeeModal principalId="p1" onClose={() => {}} onAdded={() => {}} />);
    fireEvent.click(screen.getByLabelText("Visa"));
    await waitFor(() => expect(screen.getByRole("option", { name: "L-1A" })).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("Search…"), { target: { value: "niw" } });
    expect(screen.getByRole("option", { name: "EB-2 NIW" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "L-1A" })).toBeNull();
  });

  it("adds the employee on the chosen visa and filing type exactly as before", async () => {
    const onAdded = vi.fn();
    render(<AddEmployeeModal principalId="p1" onClose={() => {}} onAdded={onAdded} />);
    fireEvent.click(screen.getByLabelText("Visa"));
    await waitFor(() => expect(screen.getByRole("option", { name: "H-1B" })).toBeTruthy());
    fireEvent.click(screen.getByRole("option", { name: "H-1B" }));
    fireEvent.change(await screen.findByDisplayValue("Select type (new, extension, transfer...)"), { target: { value: "H-1B Extension" } });
    fireEvent.click(screen.getByRole("button", { name: "Add employee" }));
    await waitFor(() => expect(api.addEmployeeSlot).toHaveBeenCalledWith("p1", { visaType: "H-1B", petitionSubType: "H-1B Extension" }));
    expect(api.setEmployeeDataEntryMode).toHaveBeenCalledWith("p1", "child1", { mode: "fill_self" });
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
  });

  it("asks for a visa before anything is created", async () => {
    render(<AddEmployeeModal principalId="p1" onClose={() => {}} onAdded={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Add employee" }));
    expect(await screen.findByText("Choose the employee's visa first.")).toBeTruthy();
    expect(api.addEmployeeSlot).not.toHaveBeenCalled();
  });
});
