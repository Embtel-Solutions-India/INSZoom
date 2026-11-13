import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UscisReceiptCard from "./UscisReceiptCard";
import { cleanReceiptNumber, USCIS_CASE_STATUS_URL } from "../utils/uscisReceipt";

const receipt = { receiptNumber: "IOE9589707612" };
const employee = (n) => ({ receiptNumber: `IOE95897076${String(10 + n)}`, caseNumber: `B505-${String.fromCharCode(64 + n)}`, employeeName: `Employee ${n}` });

describe("uscisReceipt helpers", () => {
  it("cleans and validates: three letters followed by ten digits", () => {
    expect(cleanReceiptNumber(" ioe-958 9707612 ")).toBe("IOE9589707612");
    for (const bad of ["", "12", "IOE123", "1234567890123", null, undefined]) expect(cleanReceiptNumber(bad)).toBe("");
    expect(USCIS_CASE_STATUS_URL).toBe("https://egov.uscis.gov/");
  });
});

describe("UscisReceiptCard", () => {
  beforeEach(() => { Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } }); });

  it("one receipt: 'Track your case', the number, Copy and the USCIS link", () => {
    render(<UscisReceiptCard receipt={receipt} />);
    expect(screen.getByText("Track your case")).toBeTruthy();
    expect(screen.getAllByTestId("uscis-receipt")).toHaveLength(1);
    expect(screen.getByTestId("receipt-number").textContent).toBe("IOE9589707612");
    expect(screen.queryByTestId("receipt-employee")).toBeNull();
    const link = screen.getByTestId("uscis-link");
    expect(link.getAttribute("href")).toBe("https://egov.uscis.gov/");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("copies the receipt number", async () => {
    render(<UscisReceiptCard receipt={receipt} />);
    fireEvent.click(screen.getByLabelText("Copy number"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("IOE9589707612"));
  });

  it("an employer matter: one row per employee, first three shown, the rest behind Show all", () => {
    render(<UscisReceiptCard receipts={[1, 2, 3, 4, 5].map(employee)} />);
    expect(screen.getAllByTestId("uscis-receipt")).toHaveLength(3);
    expect(screen.getByText("Employee 1")).toBeTruthy();
    fireEvent.click(screen.getByTestId("receipt-toggle"));
    expect(screen.getAllByTestId("uscis-receipt")).toHaveLength(5);
  });

  it("renders nothing without a valid receipt number", () => {
    const { container } = render(<UscisReceiptCard receipt={{ receiptNumber: "nope" }} receipts={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
