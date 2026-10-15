import { afterEach, describe, expect, it, vi } from "vitest";

// Actions that do a lot of work on the server (adding an employee slot, switching an employee's workflow, inviting, resending, withdrawing)
// wait up to 120 s instead of the 25 s of an ordinary request - giving up early does not stop the server, and a retry would repeat the action.
afterEach(() => { vi.restoreAllMocks(); });

async function timeoutUsedBy(call) {
  const timeouts = [];
  const original = AbortSignal.timeout.bind(AbortSignal);
  const spy = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => { timeouts.push(ms); return original(ms); });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } })));
  try { await call(); } finally { spy.mockRestore(); }
  return timeouts[0];
}

describe("long-running employee actions", () => {
  it("wait 120 s", async () => {
    const { casesApi } = await import("./api");
    expect(await timeoutUsedBy(() => casesApi.addEmployeeSlot("p1", { visaType: "H-1B" }))).toBe(120000);
    expect(await timeoutUsedBy(() => casesApi.setEmployeeDataEntryMode("p1", "c1", { mode: "fill_self" }))).toBe(120000);
    expect(await timeoutUsedBy(() => casesApi.inviteEmployee("p1", { childCaseId: "c1" }))).toBe(120000);
    expect(await timeoutUsedBy(() => casesApi.resendEmployeeInvite("p1", "c1"))).toBe(120000);
    expect(await timeoutUsedBy(() => casesApi.removeEmployee("c1"))).toBe(120000);
  });

  it("an ordinary request still uses the normal 25 s limit", async () => {
    const { casesApi } = await import("./api");
    expect(await timeoutUsedBy(() => casesApi.getRelated("p1", { scope: "children" }))).toBe(25000);
  });
});
