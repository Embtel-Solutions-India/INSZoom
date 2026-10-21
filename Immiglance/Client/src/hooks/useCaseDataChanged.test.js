import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const handlers = {};
const fakeSocket = {
  on: vi.fn((event, fn) => { handlers[event] = fn; }),
  off: vi.fn((event, fn) => { if (handlers[event] === fn) delete handlers[event]; }),
};
let socketValue = fakeSocket;
let authValue = { user: { _id: "me" } };
vi.mock("../context/SocketContext", () => ({ useSocket: () => socketValue }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => authValue }));

import useCaseDataChanged from "./useCaseDataChanged";

const fire = (payload) => act(async () => { handlers["case:data_changed"]?.(payload); await vi.advanceTimersByTimeAsync(450); });

describe("useCaseDataChanged", () => {
  beforeEach(() => { vi.useFakeTimers(); Object.keys(handlers).forEach((k) => delete handlers[k]); socketValue = fakeSocket; authValue = { user: { _id: "me" } }; fakeSocket.on.mockClear(); fakeSocket.off.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it("re-reads when someone else changes this case, once for a burst, and ignores other cases", async () => {
    const onChange = vi.fn();
    renderHook(() => useCaseDataChanged("case1", onChange));
    await fire({ caseId: "other", actorId: "x" });
    expect(onChange).not.toHaveBeenCalled();
    act(() => { handlers["case:data_changed"]({ caseId: "case1", actorId: "x" }); handlers["case:data_changed"]({ caseId: "case1", actorId: "y" }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(450); });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("skipOwn ignores the user's own changes but still reacts to other people's", async () => {
    const onChange = vi.fn();
    renderHook(() => useCaseDataChanged("case1", onChange, { skipOwn: true }));
    await fire({ caseId: "case1", actorId: "me" });
    expect(onChange).not.toHaveBeenCalled();
    await fire({ caseId: "case1", actorId: "case-manager" });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("is a harmless no-op without a socket, an auth context or a case, and cleans up on unmount", () => {
    socketValue = null;
    authValue = undefined;
    expect(() => renderHook(() => useCaseDataChanged("case1", vi.fn())).unmount()).not.toThrow();
    socketValue = fakeSocket;
    renderHook(() => useCaseDataChanged(null, vi.fn()));
    expect(fakeSocket.on).not.toHaveBeenCalled();
    const { unmount } = renderHook(() => useCaseDataChanged("case1", vi.fn()));
    expect(fakeSocket.on).toHaveBeenCalledWith("case:data_changed", expect.any(Function));
    unmount();
    expect(fakeSocket.off).toHaveBeenCalledWith("case:data_changed", expect.any(Function));
  });

  it("a handler that throws never breaks the screen", async () => {
    renderHook(() => useCaseDataChanged("case1", () => { throw new Error("boom"); }));
    await expect(fire({ caseId: "case1", actorId: "x" })).resolves.not.toThrow();
  });
});
