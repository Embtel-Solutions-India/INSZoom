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
const editMessage = vi.fn();
const deleteMessageForEveryone = vi.fn();
const threadState = { messages: [] };
const chunkGet = vi.fn();
const chunkPost = vi.fn();
const chunkPut = vi.fn();
vi.mock("../../services/api", () => ({
  messagesApi: {
    getThreads: () => Promise.resolve({ threads: [thread] }),
    getOrCreateThread: () => Promise.resolve({ thread }),
    getMessages: () => Promise.resolve({ messages: threadState.messages, hasMore: false }),
    typing: () => Promise.resolve({}),
    getAttachment: () => Promise.reject(new Error("no")),
    sendMessage: (...args) => sendMessage(...args),
    editMessage: (...args) => editMessage(...args),
    deleteMessageForEveryone: (...args) => deleteMessageForEveryone(...args),
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
  editMessage.mockReset();
  deleteMessageForEveryone.mockReset();
  threadState.messages = [];
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

describe("Messages replies", () => {
  const incoming = { _id: "srv-in", messageBody: "Please send your passport", senderName: "Case Manager", senderId: { _id: "team", displayName: "Case Manager" }, createdAt: new Date().toISOString(), readBy: [], attachments: [] };

  it("replies like Admin: reply bar, replyTo + clientMessageId sent, quote shown at once, bar cleared", async () => {
    threadState.messages = [incoming];
    sendMessage.mockImplementation((_t, body, _f, _i, opts) => Promise.resolve({ message: saved(body, opts.clientMessageId, { replyTo: { _id: "srv-in", senderName: "Case Manager", messageBody: incoming.messageBody } }) }));
    const box = await openThreadAndType("here you go");
    fireEvent.click(screen.getByLabelText("Reply"));
    const bar = screen.getByTestId("reply-bar");
    expect(bar.textContent).toMatch(/Replying to\s*Case Manager/);
    expect(bar.textContent).toMatch(/Please send your passport/);
    expect(document.activeElement).toBe(box);
    fireEvent.click(screen.getByLabelText("Send"));
    // The quote is in the user's own bubble before the server answers.
    expect(screen.getAllByText("Please send your passport").length).toBeGreaterThan(1);
    expect(screen.queryByTestId("reply-bar")).toBeNull();
    await flush();
    const opts = sendMessage.mock.calls[0][4];
    expect(opts.replyTo).toBe("srv-in");
    expect(opts.clientMessageId).toBeTruthy();
    expect(screen.getAllByText("here you go")).toHaveLength(1);
  });

  it("Cancel drops the reply and a plain send carries no replyTo; a failed reply keeps it on retry", async () => {
    threadState.messages = [incoming];
    sendMessage.mockRejectedValueOnce(Object.assign(new Error("Bad"), { status: 400 }));
    await openThreadAndType("one");
    fireEvent.click(screen.getByLabelText("Reply"));
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByTestId("reply-bar")).toBeNull();
    fireEvent.click(screen.getByLabelText("Reply"));
    fireEvent.click(screen.getByLabelText("Send"));
    await flush();
    sendMessage.mockImplementationOnce((_t, body, _f, _i, opts) => Promise.resolve({ message: saved(body, opts.clientMessageId) }));
    fireEvent.click(screen.getByText(/Tap to retry/));
    await flush();
    expect(sendMessage.mock.calls[1][4].replyTo).toBe("srv-in");
    expect(sendMessage.mock.calls[1][4].clientMessageId).toBe(sendMessage.mock.calls[0][4].clientMessageId);
  });
});

describe("Messages edit and delete", () => {
  const now = new Date().toISOString();
  const mine = { _id: "m-mine", messageBody: "original text", senderId: me._id, createdAt: now, readBy: [], attachments: [] };
  const theirs = { _id: "m-their", messageBody: "from the team", senderId: { _id: "team", displayName: "Case Manager" }, createdAt: now, readBy: [], attachments: [] };
  const openThread = async () => {
    render(<Messages />);
    await flush();
    fireEvent.click(screen.getByText("Immiglance Case Team"));
    await flush();
  };

  it("has one three-dots menu per message: Reply everywhere, Edit/Delete only on the user's own", async () => {
    threadState.messages = [theirs, mine];
    await openThread();
    const dots = screen.getAllByLabelText("Message options");
    expect(dots).toHaveLength(2);
    // A plain ellipsis (no chip background/border/shadow, no float) absolutely positioned in the bubble's own right gutter,
    // so short text keeps its single line and the dots never sit on the text.
    expect(dots[0].className).toMatch(/\babsolute\b.*top-1\.5.*right-1\.5/);
    expect(dots[0].className).not.toMatch(/float|border|shadow|bg-/);
    expect(dots[0].parentElement.className).toMatch(/\bpr-7\b/);
    expect(dots[0].parentElement.className).not.toMatch(/\bpx-3\b|float|pt-3|mt-2/);
    expect(dots[0].parentElement.querySelector("[class*=float-right], [class*=clear-both]")).toBeNull();
    fireEvent.click(dots[0]); // the team's message
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Reply"]);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(dots[1]); // own message
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Reply", "Edit", "Delete"]);
    fireEvent.mouseDown(document.body); // outside click closes
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("the menu's Reply option starts the same reply as the standalone Reply button", async () => {
    threadState.messages = [theirs];
    await openThread();
    fireEvent.click(screen.getByLabelText("Message options"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reply" }));
    expect(screen.getByTestId("reply-bar").textContent).toMatch(/from the team/);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("edits in place (Enter saves), then shows the new text with an Edited label beside the time", async () => {
    threadState.messages = [mine];
    editMessage.mockResolvedValue({ success: true, message: { ...mine, messageBody: "new text", editedAt: now } });
    await openThread();
    expect(screen.queryByText("Edited")).toBeNull();
    fireEvent.click(screen.getByLabelText("Message options"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    const box = screen.getByLabelText("Edit message");
    expect(box.value).toBe("original text");
    fireEvent.change(box, { target: { value: "   " } });
    expect(screen.getByText("Save").disabled).toBe(true);
    fireEvent.change(box, { target: { value: "new text" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await flush();
    expect(editMessage).toHaveBeenCalledWith("m-mine", "new text");
    expect(screen.getByText("new text")).toBeTruthy();
    expect(screen.queryByLabelText("Edit message")).toBeNull();
    expect(screen.getByText("Edited")).toBeTruthy();
  });

  it("Esc cancels an edit, and a failed save keeps the old text and the editor open", async () => {
    threadState.messages = [mine];
    editMessage.mockRejectedValue(Object.assign(new Error("nope"), { userMessage: "Could not edit" }));
    await openThread();
    fireEvent.click(screen.getByLabelText("Message options"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    fireEvent.keyDown(screen.getByLabelText("Edit message"), { key: "Escape" });
    expect(screen.queryByLabelText("Edit message")).toBeNull();
    expect(editMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Message options"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Edit message"), { target: { value: "changed" } });
    fireEvent.click(screen.getByText("Save"));
    await flush();
    expect(screen.getByLabelText("Edit message").value).toBe("changed");
    expect(screen.getByRole("alert").textContent).toMatch(/Could not edit/);
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.getByText("original text")).toBeTruthy();
  });

  it("deletes for everyone after a confirm and leaves a 'This message was deleted' placeholder", async () => {
    threadState.messages = [mine];
    deleteMessageForEveryone.mockResolvedValue({ success: true, message: { ...mine, messageBody: "", attachments: [], deletedForEveryoneAt: now } });
    await openThread();
    fireEvent.click(screen.getByLabelText("Message options"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(/deleted for everyone in this conversation/);
    expect(screen.getByRole("button", { name: "Delete" }).className).toMatch(/bg-primary/);
    expect(screen.getByRole("button", { name: "Delete" }).className).not.toMatch(/destructive/);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await flush();
    expect(deleteMessageForEveryone).toHaveBeenCalledWith("m-mine");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("deleted-message").textContent).toMatch(/This message was deleted/);
    expect(screen.queryByText("original text")).toBeNull();
    expect(screen.queryByLabelText("Message options")).toBeNull();
    expect(screen.queryByLabelText("Reply")).toBeNull();
  });

  it("a failed delete leaves 'Working…', shows the error and keeps the message; a retry then succeeds", async () => {
    threadState.messages = [mine];
    deleteMessageForEveryone.mockRejectedValueOnce(Object.assign(new Error("boom"), { userMessage: "Could not delete" }));
    await openThread();
    fireEvent.click(screen.getByLabelText("Message options"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await flush();
    expect(screen.queryByText(/Working/)).toBeNull();
    expect(screen.getByRole("alertdialog").textContent).toMatch(/Could not delete/);
    expect(screen.getByText("original text")).toBeTruthy();
    deleteMessageForEveryone.mockResolvedValueOnce({ success: true, message: { ...mine, messageBody: "", attachments: [], deletedForEveryoneAt: now } });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await flush();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByTestId("deleted-message")).toBeTruthy();
  });

  it("places the compact menu right-aligned under the dots, clamped to the chat pane, opening upward when short of room", async () => {
    threadState.messages = [mine];
    await openThread();
    const original = HTMLElement.prototype.getBoundingClientRect;
    const rects = { pane: { left: 300, right: 800, top: 60, bottom: 560 }, button: { left: 740, right: 756, top: 100, bottom: 116 } };
    const asRect = (r) => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top });
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute("data-chat-scroll")) return asRect(rects.pane);
      if (this.getAttribute("aria-label") === "Message options") return asRect(rects.button);
      return original.call(this);
    };
    try {
      fireEvent.click(screen.getByLabelText("Message options"));
      let menu = screen.getByRole("menu");
      expect(menu.className).toMatch(/\bw-32\b/);
      expect(menu.style.left).toBe("628px"); // the dots' right edge (756) - 128: opens toward the left, inside the pane
      expect(menu.style.top).toBe("120px"); // 4px below the dots
      fireEvent.keyDown(document, { key: "Escape" });

      rects.button = { left: 400, right: 416, top: 500, bottom: 516 }; // near the pane's bottom edge: opens upward
      fireEvent.click(screen.getByLabelText("Message options"));
      menu = screen.getByRole("menu");
      expect(menu.style.left).toBe("308px"); // clamped to the pane's left edge + 8px inset (416 - 128 would be 288)
      expect(menu.style.top).toBe("392px"); // 500 - 4 - (8 + 3 * 32)
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });

  it("the time/ticks row extends into the dots' gutter so it ends under the dots, only on bubbles that have the dots", async () => {
    threadState.messages = [mine, { ...mine, _id: "m-gone", deletedForEveryoneAt: now, messageBody: "" }];
    await openThread();
    const [myDots] = screen.getAllByLabelText("Message options");
    const bubble = myDots.parentElement;
    expect(bubble.className).toMatch(/\bpr-7\b/); // gutter 28px; dots inset 6px -> the footer pulls 22px back into it
    const footer = bubble.querySelector("[class*='-mr-[22px]']");
    expect(footer).not.toBeNull();
    expect(footer.className).not.toMatch(/\bpr-1\b/);
    // The deleted bubble has no dots and no gutter, so its footer keeps the normal layout.
    const deletedBubble = screen.getByTestId("deleted-message").parentElement;
    expect(deletedBubble.className).not.toMatch(/\bpr-7\b/);
    expect(deletedBubble.querySelector("[class*='-mr-[22px]']")).toBeNull();
  });

  it("applies live message:update / message:delete events by _id (idempotent), including a quoted reply target", async () => {
    const reply = { _id: "m-reply", messageBody: "answer", senderId: me._id, createdAt: now, readBy: [], attachments: [], replyTo: { _id: "m-their", senderName: "Case Manager", messageBody: "from the team" } };
    threadState.messages = [theirs, reply];
    await openThread();
    expect(screen.getAllByText("from the team")).toHaveLength(2); // the message and the quote in the reply

    const edited = { ...theirs, messageBody: "team text v2", editedAt: now, conversationId: "t1" };
    act(() => { socketHandlers["message:update"](edited); });
    act(() => { socketHandlers["message:update"](edited); });
    expect(screen.getAllByText("team text v2")).toHaveLength(2);
    expect(screen.getAllByText("Edited")).toHaveLength(1);

    const deleted = { ...theirs, messageBody: "", attachments: [], editedAt: now, deletedForEveryoneAt: now, conversationId: "t1" };
    act(() => { socketHandlers["message:delete"](deleted); });
    act(() => { socketHandlers["message:delete"](deleted); });
    expect(screen.queryByText("team text v2")).toBeNull();
    expect(screen.queryByText("Edited")).toBeNull();
    expect(screen.getByTestId("deleted-message")).toBeTruthy();
    expect(screen.getAllByText("This message was deleted")).toHaveLength(2); // the bubble and the quote in the reply
    expect(screen.getByText("answer")).toBeTruthy();
  });
});
