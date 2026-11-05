import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EarlierCaseNote, { earlierCaseSource } from "./EarlierCaseNote";

afterEach(cleanup);
const copied = { auditHistory: [{ action: "auto_saved" }, { action: "prefilled_from_earlier_case", changes: { sourceVisaType: "H-1B", sourceCaseNumber: "B471" } }] };

describe("EarlierCaseNote (Phase 3A)", () => {
  it("names the earlier case while the answer is still the copied one", () => {
    render(<EarlierCaseNote answer={copied} />);
    expect(screen.getByTestId("earlier-case-note").textContent).toMatch(/Pre-filled from your earlier case \(H-1B · B471\)/);
  });
  it("disappears once the person changes the answer, and shows nothing for ordinary answers", () => {
    expect(earlierCaseSource({ auditHistory: [...copied.auditHistory, { action: "auto_saved" }] })).toBe(null);
    const { container } = render(<EarlierCaseNote answer={{ auditHistory: [{ action: "submitted" }] }} />);
    expect(container.textContent).toBe("");
    expect(earlierCaseSource(undefined)).toBe(null);
  });
});
