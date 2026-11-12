import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import QuestionInput from "./QuestionInput";

const question = { key: "doc_x", type: "file", label: "Documents" };
const files = [{ storageKey: "k1", originalName: "I-907_2026-11-10.pdf", size: 965000, mimeType: "application/pdf" }];

describe("an uploaded checklist document opens in the full-screen viewer", () => {
  it("shows a View button for an uploaded file and opens the viewer with the file's bytes", async () => {
    const getFileBlob = vi.fn().mockResolvedValue(new Blob(["%PDF-1.4"], { type: "application/pdf" }));
    globalThis.URL.createObjectURL = vi.fn(() => "blob:test");
    globalThis.URL.revokeObjectURL = vi.fn();
    render(<QuestionInput question={question} files={files} onFileChange={vi.fn()} onRemoveFile={vi.fn()} getFileBlob={getFileBlob} />);
    fireEvent.click(screen.getByRole("button", { name: /view entry 1/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "I-907_2026-11-10.pdf" })).toBeTruthy());
    await waitFor(() => expect(getFileBlob).toHaveBeenCalledTimes(1));
    expect(getFileBlob.mock.calls[0][0]).toMatchObject({ storageKey: "k1" });
  });

  it("without a viewer source nothing changes: no View button (existing behaviour)", () => {
    render(<QuestionInput question={question} files={files} onFileChange={vi.fn()} onRemoveFile={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /view entry 1/i })).toBeNull();
  });
});
