import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// Messages.jsx sending behaviour: optimistic bubble, one sequential queue, automatic
// retry with the SAME clientMessageId, tap-to-retry, and no duplicate from a socket echo.
// Everything is mocked - no network, no database.
const me = { _id: "u-me", displayName: "Casey Client", email: "casey@example.com", role: "client" };
const thread = { _id: "t1", subject: "Case", unreadClient: 0, lastMessageAt: new Date().toISOString(), caseId: { caseId: "C-1", visaType: "H-1B" } };

vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: me }) }));

const socketHandlers = {};
const mockSocket = {
  on: (event, fn) => { socketHandlers[event] = fn; },
  off: (event) => { delete socketHandlers[event]; },
};
vi.mock("../../context/SocketContext", () => ({ useSocket: () => mockSocket }));
vi.mock("../../hooks/useMyCaseProfile", () => ({ useMyCase: () => ({ data: { _id: "case1" } }) }));

const sendMessage = vi.fn();
const chunkGet = vi.fn();
const chunkPost = vi.fn();
const chunkPut = vi.fn();
vi.mock("../../services/api", () => ({
  messagesApi: {
    getThreads: () => Promise.resolve({ threads: [thread] }),
    getOrCreateThread: () => Promise.resolve({ thread }),
    getMessages: () => Promise.resolve({ messages: [], hasMore: false }),
    typing: () => Promise.resolve({}),
    getAttachment: () => Promise.reject(new Error("no")),
    sendMessage: (...args) => sendMessage(...args),
  },
  usersApi: { getPresence: () => Promise.resolve({ presence: {} }) },
  chunkApi: {
    get: (...a) => chunkGet(...a),
    post: (...a) => chunkPost(...a),
    put: (...a) => chunkPut(...a),
    delete: () => Promise.resolve({ data: {} }),
  },
}));

import Messages from "./Messages";

const saved = (body, clientMessageId, extra = {}) => ({
  _id: `srv-${clientMessageId}`,
  messageBody: body,
  clientMessageId,
  createdAt: new Date().toISOString(),
  senderId: me,
  readBy: [{ userId: me._id }],
  attachments: [],
  ...extra,
});
const netError = () => Object.assign(new Error("Unable to reach the server."), { isNetworkError: true });
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

async function openThreadAndType(text) {
  render(<Messages />);
  await flush();
  fireEvent.click(screen.getByText("Immiglance Case Team"));
  await flush();
  const box = screen.getByPlaceholderText(/Type your message/);
  fireEvent.change(box, { target: { value: text } });
  return box;
}

beforeEach(() => {
  vi.useFakeTimers();
  sendMessage.mockReset();
  chunkGet.mockReset();
  chunkPost.mockReset();
  chunkPut.mockReset();
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Messages sending", () => {
  it("shows the message at once, never locks Send, and retries a network failure with the same clientMessageId", async () => {
    sendMessage
      .mockRejectedValueOnce(netError())
      .mockImplementationOnce((_t, body, _f, _i, opts) => Promise.resolve({ message: saved(body, opts.clientMessageId) }));
    const box = await openThreadAndType("hello team");
    fireEvent.click(screen.getByLabelText("Send"));
    await flush();

    // Optimistic bubble is already in the thread (shown as sent, not "Sending...").
    expect(screen.getByText("hello team")).toBeTruthy();
    expect(screen.queryByText(/Sending/)).toBeNull();
    // The composer was cleared and the Send button is usable for the next message while the first is in flight.
    expect(box.value).toBe("");
    fireEvent.change(box, { target: { value: "second" } });
    expect(screen.getByLabelText("Send").disabled).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    const ids = sendMessage.mock.calls.map((c) => c[4].clientMessageId);
    expect(ids[0]).toBeTruthy();
    expect(ids[1]).toBe(ids[0]);
    expect(screen.getAllByText("hello team")).toHaveLength(1);
  });

  it("delivers in order through one queue", async () => {
    const order = [];
    sendMessage.mockImplementation((_t, body, _f, _i, opts) => { order.push(body); return Promise.resolve({ message: saved(body, opts.clientMessageId) }); });
    const box = await openThreadAndType("one");
    fireEvent.click(screen.getByLabelText("Send"));
    fireEvent.change(box, { target: { value: "two" } });
    fireEvent.click(screen.getByLabelText("Send"));
    await flush();
    await flush();
    expect(order).toEqual(["one", "two"]);
  });

  it("treats a 4xx as final, shows the failure, and a tap retries with the SAME clientMessageId", async () => {
    sendMessage.mockRejectedValueOnce(Object.assign(new Error("Bad"), { status: 400 }));
    await openThreadAndType("nope");
    fireEvent.click(screen.getByLabelText("Send"));
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    const failedText = screen.getAllByText(/Failed to send/);
    expect(failedText.length).toBeGreaterThan(0);

    sendMessage.mockImplementationOnce((_t, body, _f, _i, opts) => Promise.resolve({ message: saved(body, opts.clientMessageId) }));
    fireEvent.click(screen.getByText(/Tap to retry/));
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][4].clientMessageId).toBe(sendMessage.mock.calls[0][4].clientMessageId);
    expect(screen.queryByText(/Tap to retry/)).toBeNull();
    expect(screen.getAllByText("nope")).toHaveLength(1);
  });

  it("gives up after the retry delays on repeated network errors and marks the bubble failed", async () => {
    sendMessage.mockRejectedValue(netError());
    await openThreadAndType("flaky");
    fireEvent.click(screen.getByLabelText("Send"));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000 + 5000 + 10000); });
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(screen.getByText(/Tap to retry/)).toBeTruthy();
  });

  it("does not duplicate the message when the socket echo arrives before the response", async () => {
    let resolveSend;
    sendMessage.mockImplementationOnce(() => new Promise((resolve) => { resolveSend = resolve; }));
    await openThreadAndType("echo me");
    fireEvent.click(screen.getByLabelText("Send"));
    await flush();
    const cid = sendMessage.mock.calls[0][4].clientMessageId;

    // Echo as the gateway emits it: sender is a bare id.
    act(() => { socketHandlers["message:new"]({ ...saved("echo me", cid), senderId: me._id }); });
    expect(screen.getAllByText("echo me")).toHaveLength(1);

    await act(async () => { resolveSend({ message: saved("echo me", cid) }); });
    await flush();
    expect(screen.getAllByText("echo me")).toHaveLength(1);

    // A later duplicate echo of the same stored message is ignored too.
    act(() => { socketHandlers["message:new"](saved("echo me", cid)); });
    expect(screen.getAllByText("echo me")).toHaveLength(1);
  });
});

describe("Messages attachments", () => {
  const attach = (files) => fireEvent.change(document.getElementById("messages-attachments"), { target: { files } });
  const smallFile = (name = "a.pdf", size = 1000) => new File([new Uint8Array(size)], name, { type: "application/pdf" });
  const bigFile = () => new File([new Uint8Array(5 * 1024 * 1024 + 10)], "big.mp4", { type: "video/mp4" });
  const MB5 = 5 * 1024 * 1024;
  const chunkOk = () => {
    chunkPost.mockImplementation((url) => Promise.resolve({ data: url === "/chunked-uploads" ? { uploadId: "up1", chunkBytes: MB5, totalChunks: 2 } : {} }));
    chunkPut.mockResolvedValue({ data: {} });
  };

  it("shows a file-only message at once (name + size + time) and sends it as multipart", async () => {
    sendMessage.mockImplementation((_t, body, _f, _i, opts) => Promise.resolve({ message: saved(body, opts.clientMessageId) }));
    await openThreadAndType("");
    attach([smallFile("passport.pdf", 2048)]);
    expect(screen.getByText(/passport\.pdf/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Send"));
    await flush();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][2]).toHaveLength(1);
    expect(sendMessage.mock.calls[0][4].uploadIds).toEqual([]);
  });

  it("rejects empty files and more than 5 attachments with an inline notice", async () => {
    await openThreadAndType("");
    attach([new File([], "empty.txt")]);
    expect(screen.getByTestId("attach-notice").textContent).toMatch(/empty/);
    attach([1, 2, 3, 4, 5, 6].map((n) => smallFile(`f${n}.pdf`)));
    expect(screen.getByTestId("attach-notice").textContent).toMatch(/up to 5 files/);
    expect(screen.getAllByLabelText(/^Remove /)).toHaveLength(5);
  });

  it("uploads a big file in chunks first, then sends its uploadId with the message", async () => {
    chunkOk();
    sendMessage.mockImplementation((_t, body, _f, _i, opts) => Promise.resolve({ message: saved(body, opts.clientMessageId) }));
    await openThreadAndType("see video");
    attach([bigFile()]);
    fireEvent.click(screen.getByLabelText("Send"));
    await flush();
    await flush();
    expect(chunkPut).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][2]).toHaveLength(0);
    expect(sendMessage.mock.calls[0][4].uploadIds).toEqual(["up1"]);
  });

  it("on retry reuses the finished upload and the same clientMessageId", async () => {
    chunkOk();
    sendMessage.mockRejectedValueOnce(Object.assign(new Error("Bad"), { status: 400 }));
    await openThreadAndType("");
    attach([bigFile()]);
    fireEvent.click(screen.getByLabelText("Send"));
    await flush();
    await flush();
    expect(screen.getByText(/Tap to retry/)).toBeTruthy();
    sendMessage.mockImplementationOnce((_t, body, _f, _i, opts) => Promise.resolve({ message: saved(body, opts.clientMessageId) }));
    fireEvent.click(screen.getByText(/Tap to retry/));
    await flush();
    await flush();
    expect(chunkPost).toHaveBeenCalledTimes(2); // init + complete, once: the second attempt did not upload again
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][4].uploadIds).toEqual(["up1"]);
    expect(sendMessage.mock.calls[1][4].clientMessageId).toBe(sendMessage.mock.calls[0][4].clientMessageId);
  });
});
