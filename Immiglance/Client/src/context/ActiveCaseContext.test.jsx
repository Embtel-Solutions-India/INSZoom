import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// One login, many cases (Phase 2A): which case is open, the header switcher, and that the "my case" requests carry the case only when one is open.
const auth = vi.hoisted(() => ({ value: { user: { _id: "u1", role: "client" }, authStatus: "authenticated" } }));
vi.mock("./AuthContext", () => ({ useAuth: () => auth.value }));
const mine = vi.hoisted(() => vi.fn());
vi.mock("../services/api", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, casesApi: { ...actual.casesApi, mine: (...a) => mine(...a) } };
});

import { ActiveCaseProvider, useActiveCase, employeeViewFor } from "./ActiveCaseContext";
import CaseSwitcher from "../components/CaseSwitcher";
import { activeCaseStore, casesApi } from "../services/api";

const A = "a".repeat(24), B = "b".repeat(24), C = "c".repeat(24);
const three = { data: { cases: [
  { _id: A, caseNumber: "B100", visaType: "H-1B", capacity: "client", status: "assigned" },
  { _id: B, caseNumber: "B200", visaType: "I-765 EAD", capacity: "client", status: "intake" },
  { _id: C, caseNumber: "B300", visaType: "PERM", capacity: "employer", status: "assigned" },
], defaultCaseId: A } };

function Probe() {
  const { activeCaseId, multiCase } = useActiveCase();
  return <p data-testid="probe">{multiCase ? "multi" : "single"}:{activeCaseId || "none"}</p>;
}
const renderWith = (ui) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ActiveCaseProvider>{ui}</ActiveCaseProvider></QueryClientProvider>);

beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, "", "/dashboard"); });
afterEach(() => { cleanup(); vi.clearAllMocks(); activeCaseStore.set(null); });

describe("ActiveCaseProvider", () => {
  it("one case: nothing is selected and nothing changes", async () => {
    mine.mockResolvedValue({ data: { cases: [three.data.cases[0]], defaultCaseId: A } });
    renderWith(<Probe />);
    await waitFor(() => expect(mine).toHaveBeenCalled());
    expect(screen.getByTestId("probe").textContent).toBe("single:none");
    expect(activeCaseStore.get().id).toBe(null);
  });

  it("three cases: opens the default case; ?case= in the address wins; an id that is not theirs is ignored", async () => {
    mine.mockResolvedValue(three);
    const first = renderWith(<Probe />);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe(`multi:${A}`));
    first.unmount();
    window.history.replaceState({}, "", `/dashboard?case=${B}`);
    const second = renderWith(<Probe />);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe(`multi:${B}`));
    second.unmount();
    window.history.replaceState({}, "", `/dashboard?case=${"f".repeat(24)}`);
    renderWith(<Probe />);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe(`multi:${A}`));
  });

  it("Phase 2B: an employee login with a case of its OWN gets the switcher; only its own case sends the own-case signal", async () => {
    auth.value = { user: { _id: "u2", role: "employee" }, authStatus: "authenticated" };
    mine.mockResolvedValue({ data: { cases: [
      { _id: A, caseNumber: "B100-A", visaType: "H-1B", capacity: "employee", status: "assigned" },
      { _id: B, caseNumber: "B200", visaType: "I-765 EAD", capacity: "client", status: "intake" },
    ], defaultCaseId: A } });
    renderWith(<><CaseSwitcher caseRef="B100-A" visaLabel="H-1B" displayName="Eli" /><Probe /></>);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe(`multi:${A}`));
    expect(activeCaseStore.get()).toEqual({ id: A, capacity: "employee", ownCase: false }, "the invited case: the employee view, no signal");
    fireEvent.click(screen.getByRole("button", { name: /Open another case \(2 cases\)/ }));
    fireEvent.click(screen.getByRole("option", { name: /I-765 EAD/ }));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe(`multi:${B}`));
    expect(activeCaseStore.get()).toEqual({ id: B, capacity: "client", ownCase: true }, "their own case: the client view + the signal");
    auth.value = { user: { _id: "u1", role: "client" }, authStatus: "authenticated" };
  });
});

describe("CaseSwitcher", () => {
  it("lists every case with visa, number, role and status, and switches to the one picked (remembered for this tab)", async () => {
    mine.mockResolvedValue(three);
    const onSwitched = vi.fn();
    renderWith(<><CaseSwitcher caseRef="B100" visaLabel="H-1B" displayName="Sam" onSwitched={onSwitched} /><Probe /></>);
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe(`multi:${A}`));
    fireEvent.click(screen.getByRole("button", { name: /Open another case \(3 cases\)/ }));
    expect(screen.getByRole("option", { name: /I-765 EAD/ })).toBeTruthy();
    expect(screen.getByText(/B300 · Employer · assigned/)).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /I-765 EAD/ }));
    await waitFor(() => expect(screen.getByTestId("probe").textContent).toBe(`multi:${B}`));
    expect(onSwitched).toHaveBeenCalled();
    expect(activeCaseStore.get()).toEqual({ id: B, capacity: "client", ownCase: false }, "a client login never sends the own-case signal");
    expect(sessionStorage.getItem("immiglance.activeCase.u1")).toBe(B);
  });
});

describe("my-case requests", () => {
  it("carry ?caseId= only while a case is open", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await casesApi.my().catch(() => {});
    expect(String(fetchSpy.mock.calls.at(-1)[0])).not.toMatch(/caseId=/);
    activeCaseStore.set({ id: B, capacity: "client" });
    await casesApi.my().catch(() => {});
    expect(String(fetchSpy.mock.calls.at(-1)[0])).toMatch(new RegExp(`/cases/my\\?caseId=${B}$`));
    fetchSpy.mockRestore();
  });
});

describe("Phase 2B: employee view follows the open case", () => {
  it("one case: exactly the old role rule; several: the role on the open case", () => {
    expect(employeeViewFor({ role: "employee" }, null)).toBe(true);
    expect(employeeViewFor({ role: "client" }, null)).toBe(false);
    expect(employeeViewFor({ role: "employee" }, { capacity: "client" })).toBe(false);
    expect(employeeViewFor({ role: "beneficiary" }, { capacity: "petitioner" })).toBe(false);
    expect(employeeViewFor({ role: "employee" }, { capacity: "employee" })).toBe(true);
    expect(employeeViewFor({ role: "client" }, { capacity: "beneficiary" })).toBe(true);
  });

  it("the own-case signal goes on case requests, never on sign-in / session calls", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const headersOf = (call) => new Headers(call[1]?.headers || {});
    activeCaseStore.set({ id: B, capacity: "client", ownCase: true });
    await casesApi.my().catch(() => {});
    expect(headersOf(fetchSpy.mock.calls.at(-1)).get("X-Active-Case")).toBe(B);
    const { authApi } = await import("../services/api");
    if (authApi?.me) {
      await authApi.me().catch(() => {});
      expect(headersOf(fetchSpy.mock.calls.at(-1)).get("X-Active-Case")).toBe(null);
    }
    activeCaseStore.set({ id: B, capacity: "client", ownCase: false });
    await casesApi.my().catch(() => {});
    expect(headersOf(fetchSpy.mock.calls.at(-1)).get("X-Active-Case")).toBe(null);
    fetchSpy.mockRestore();
  });
});
