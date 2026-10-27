import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The Client Portal's Petition page: the list of petitions sent for my review, the 85% / 15% viewer with the Feedback column, the full conversation window, live updates.
// Everything is mocked - no network, no database.
const me = { _id: "u-me", displayName: "Casey Client", role: "client" };
vi.mock("../../context/AuthContext", () => ({ useAuth: () => ({ user: me }) }));

const socketHandlers = {};
const mockSocket = {
  on: (event, fn) => { socketHandlers[event] = fn; },
  off: (event) => { delete socketHandlers[event]; },
};
vi.mock("../../context/SocketContext", () => ({ useSocket: () => mockSocket }));

const api = { list: vi.fn(), file: vi.fn(), messages: vi.fn(), send: vi.fn(), markRead: vi.fn(), viewLink: vi.fn(), ready: vi.fn() };
vi.mock("../../services/api", () => ({ petitionReviewApi: { list: (...a) => api.list(...a), file: (...a) => api.file(...a), messages: (...a) => api.messages(...a), send: (...a) => api.send(...a), markRead: (...a) => api.markRead(...a), viewLink: (...a) => api.viewLink(...a), ready: (...a) => api.ready(...a), streamUrl: (token, { download } = {}) => `https://api.test/petition-review/stream/${token}${download ? "?download=1" : ""}` } }));

import Petition from "./Petition";
import { clearViewLinks } from "../../components/petition/usePetitionStream";

const message = (id, authorId, authorName, body, side = "staff") => ({ _id: id, documentId: "d1", authorId, authorName, side, body, createdAt: "2026-10-28T15:00:00.000Z" });
const item = (extra = {}) => ({
  documentId: "d1", caseId: "c1", caseNumber: "H1B-2026-0007", fileName: "H-1B Petition.pdf", uploadedAt: "2026-10-20T10:00:00.000Z",
  clientReview: { sentAt: "2026-10-27T12:00:00.000Z", count: 1 },
  messages: { total: 7, unread: 2, latest: [message("m3", "u-cm", "Casey Manager", "We corrected your middle name."), message("m4", "u-me", "Casey Client", "Thank you, looks right now.", "client")] },
  ...extra,
});

beforeEach(() => {
  api.list.mockResolvedValue({ data: { items: [item()] } });
  api.viewLink.mockResolvedValue({ data: { token: "tok" } });
  api.ready.mockResolvedValue({ data: { ready: true } });
  api.messages.mockResolvedValue({ data: { messages: [message("m1", "u-cm", "Casey Manager", "Please review the petition.")], hasMore: false } });
  api.markRead.mockResolvedValue({ data: { ok: true } });
  api.send.mockImplementation((documentId, body, clientMessageId) => Promise.resolve({ data: { message: { ...message(`srv-${clientMessageId}`, "u-me", "Casey Client", body, "client"), clientMessageId } } }));
  globalThis.URL.createObjectURL = vi.fn(() => "blob:petition");
  globalThis.URL.revokeObjectURL = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); clearViewLinks(); vi.clearAllMocks(); Object.keys(socketHandlers).forEach((key) => delete socketHandlers[key]); });

describe("Petition list", () => {
  it("lists each petition with its case, the date it was sent, and the three actions View / Download / Feedback", async () => {
    render(<Petition />);
    expect(await screen.findByText("H-1B Petition.pdf")).toBeTruthy();
    expect(screen.getByText(/Case H1B-2026-0007/)).toBeTruthy();
    expect(screen.getByText(/October 27, 2026/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "View" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download" })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Feedback/ })).toBeTruthy();
    expect(screen.getByLabelText("2 unread")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Petition" })).toBeTruthy();
  });

  it("shows the latest feedback under the petition, in the same card: 'You' for my own messages, the case manager's name for theirs, and how many of the total", async () => {
    render(<Petition />);
    const card = (await screen.findByText("H-1B Petition.pdf")).closest("li");
    expect(within(card).getByText("We corrected your middle name.")).toBeTruthy();
    expect(within(card).getByText("Thank you, looks right now.")).toBeTruthy();
    expect(within(card).getByText("You")).toBeTruthy();
    expect(within(card).getByText("Casey Manager")).toBeTruthy();
    expect(within(card).getByText(/Latest feedback · 2 of 7/)).toBeTruthy();
  });

  it("says plainly when nothing was sent yet, and offers a retry when loading fails", async () => {
    api.list.mockResolvedValueOnce({ data: { items: [] } });
    render(<Petition />);
    expect(await screen.findByText("No petition is ready for your review yet")).toBeTruthy();
    cleanup();
    api.list.mockRejectedValueOnce(new Error("Network down"));
    render(<Petition />);
    expect(await screen.findByText("We could not load your petitions")).toBeTruthy();
    api.list.mockResolvedValue({ data: { items: [item()] } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("H-1B Petition.pdf")).toBeTruthy();
  });

  it("Download goes through the prepared stream (no request time limit): the browser is pointed at the attachment link under the petition's own name", async () => {
    const seen = {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function recordClick() { seen.href = this.href; seen.name = this.download; });
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: "Download" }));
    await waitFor(() => expect(click).toHaveBeenCalled());
    expect(seen.href).toBe("https://api.test/petition-review/stream/tok?download=1");
    expect(seen.name).toBe("H-1B Petition.pdf");
    expect(api.file).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("refreshes by itself when a message or a newly sent petition arrives live", async () => {
    render(<Petition />);
    await screen.findByText("H-1B Petition.pdf");
    expect(api.list).toHaveBeenCalledTimes(1);
    api.list.mockResolvedValue({ data: { items: [item({ messages: { total: 8, unread: 3, latest: [message("m9", "u-cm", "Casey Manager", "A brand new answer")] } })] } });
    await act(async () => { socketHandlers["petition:message"]({ documentId: "d1" }); await new Promise((resolve) => setTimeout(resolve, 450)); });
    expect(await screen.findByText("A brand new answer")).toBeTruthy();
    expect(screen.getByLabelText("3 unread")).toBeTruthy();
  });
});

describe("Petition viewer", () => {
  it("View opens the petition in the software: the PDF in the 75% area, a 'Feedback' column of 25% with a message box and Send", async () => {
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog", { name: /H-1B Petition\.pdf/ });
    const frame = await waitFor(() => { const el = within(dialog).getByTitle(/Petition: H-1B Petition\.pdf/); expect(el.getAttribute("src")).toBe("https://api.test/petition-review/stream/tok"); return el; });
    expect(api.viewLink).toHaveBeenCalledWith("d1");
    expect(api.file).not.toHaveBeenCalled();
    const grid = frame.closest("section").parentElement;
    expect(grid.className).toContain("lg:grid-cols-[75fr_25fr]");
    expect(dialog.className).toContain("fixed inset-0");
    const aside = within(dialog).getByLabelText("Feedback", { selector: "aside" });
    expect(within(aside).getByRole("heading", { name: "Feedback" })).toBeTruthy();
    expect(await within(aside).findByText("Please review the petition.")).toBeTruthy();
    expect(within(aside).getByPlaceholderText("Write your feedback…")).toBeTruthy();
    expect(within(aside).getByRole("button", { name: "Send" })).toBeTruthy();
  });

  it("sends feedback: the message shows at once, goes to the server once with a client message id, and the box is cleared; Enter sends, Shift+Enter does not", async () => {
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    const box = await within(dialog).findByPlaceholderText("Write your feedback…");
    fireEvent.change(box, { target: { value: "Please fix the date on page 3" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(api.send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await within(dialog).findByText("Please fix the date on page 3")).toBeTruthy();
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(1));
    const [documentId, body, clientMessageId] = api.send.mock.calls[0];
    expect([documentId, body]).toEqual(["d1", "Please fix the date on page 3"]);
    expect(clientMessageId.length).toBeGreaterThan(8);
    expect(box.value).toBe("");
    await waitFor(() => expect(within(dialog).getAllByText("Please fix the date on page 3").length).toBe(1));
  });

  it("an empty message is not sent; a failed send stays in the thread with Retry, and the retry reuses the same message id", async () => {
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    const box = await within(dialog).findByPlaceholderText("Write your feedback…");
    expect(within(dialog).getByRole("button", { name: "Send" }).disabled).toBe(true);
    fireEvent.change(box, { target: { value: "   " } });
    expect(within(dialog).getByRole("button", { name: "Send" }).disabled).toBe(true);

    api.send.mockRejectedValueOnce(new Error("Network down"));
    fireEvent.change(box, { target: { value: "Retry me" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send" }));
    fireEvent.click(await within(dialog).findByRole("button", { name: "Retry" }));
    await waitFor(() => expect(api.send).toHaveBeenCalledTimes(2));
    expect(api.send.mock.calls[1][2]).toBe(api.send.mock.calls[0][2]);
  });

  it("a case-manager answer arriving live appears in the open thread without a reload, once", async () => {
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Please review the petition.");
    const live = message("m-live", "u-cm", "Casey Manager", "Updated the petition, please look again.");
    await act(async () => { socketHandlers["petition:message"]({ documentId: "d1", message: live }); socketHandlers["petition:message"]({ documentId: "d1", message: live }); });
    expect(within(dialog).getAllByText("Updated the petition, please look again.").length).toBe(1);
  });

  it("Escape closes the viewer and returns to the list", async () => {
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a petition that no longer exists says so (and only then) instead of showing a blank frame", async () => {
    api.viewLink.mockRejectedValue(Object.assign(new Error("This petition was not found."), { status: 404 }));
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    expect(await screen.findByText("This petition is no longer available.")).toBeTruthy();
  });

  it("a big petition that takes a while to prepare shows 'Opening your petition' and keeps asking by itself - the person never sees a timeout message", async () => {
    // like the real long-poll: each "not ready yet" answer arrives after the server has waited a while
    const notYet = () => new Promise((resolve) => setTimeout(() => resolve({ data: { ready: false } }), 250));
    api.ready.mockImplementationOnce(notYet).mockImplementationOnce(notYet).mockResolvedValue({ data: { ready: true } });
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Opening your petition…")).toBeTruthy();
    expect(await within(dialog).findByText(/keep trying automatically/)).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByTitle(/Petition: H-1B Petition\.pdf/).getAttribute("src")).toContain("/stream/tok"), { timeout: 4000 });
    expect(api.ready).toHaveBeenCalledTimes(3);
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(screen.queryByText(/took too long/i)).toBeNull();
  });

  it("a server hiccup (a 504 / network drop) while preparing is retried quietly until it works", async () => {
    api.viewLink.mockRejectedValueOnce(Object.assign(new Error("The server took too long to respond. Please try again."), { status: 504 })).mockResolvedValue({ data: { token: "tok" } });
    api.ready.mockRejectedValueOnce(new Error("Network down")).mockResolvedValue({ data: { ready: true } });
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: "View" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByTitle(/Petition: H-1B Petition\.pdf/).getAttribute("src")).toContain("/stream/tok"), { timeout: 6000 });
    expect(screen.queryByText(/took too long/i)).toBeNull();
  });

  it("hovering View starts preparing the file before the click", async () => {
    render(<Petition />);
    fireEvent.mouseEnter(await screen.findByRole("button", { name: "View" }));
    await waitFor(() => expect(api.ready).toHaveBeenCalled());
    expect(api.viewLink).toHaveBeenCalledWith("d1");
  });
});

describe("Feedback conversation window", () => {
  it("clicking the latest-feedback block opens the whole conversation (a Messages-style window)", async () => {
    render(<Petition />);
    fireEvent.click(await screen.findByLabelText("Open the feedback conversation for H-1B Petition.pdf"));
    const dialog = await screen.findByRole("dialog", { name: "Feedback for H-1B Petition.pdf" });
    expect(await within(dialog).findByText("Please review the petition.")).toBeTruthy();
    expect(api.messages).toHaveBeenCalledWith("d1", { limit: 100 });
    expect(api.markRead).toHaveBeenCalledWith("d1");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the Feedback button opens the same conversation", async () => {
    render(<Petition />);
    fireEvent.click(await screen.findByRole("button", { name: /^Feedback/ }));
    expect(await screen.findByRole("dialog", { name: "Feedback for H-1B Petition.pdf" })).toBeTruthy();
  });
});
