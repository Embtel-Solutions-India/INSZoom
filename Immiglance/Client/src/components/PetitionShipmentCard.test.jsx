import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PetitionShipmentCard from "./PetitionShipmentCard";
import { cleanTrackingNumber, displayTrackingNumber, fedexTrackingUrl, isValidTrackingNumber } from "../utils/fedexTracking";

const shipment = { carrier: "fedex", trackingNumber: "794644790138", shippedAt: "2026-11-10T00:00:00.000Z" };
const employee = (n, extra = {}) => ({ carrier: "fedex", trackingNumber: `7946447901${String(n).padStart(2, "0")}`, shippedAt: null, caseNumber: `B505-${String.fromCharCode(64 + n)}`, employeeName: `Employee ${n}`, ...extra });

describe("fedexTracking helpers", () => {
  it("cleans, validates and builds the FedEx link only from a valid number", () => {
    expect(cleanTrackingNumber(" 7946-4479 0138 ")).toBe("794644790138");
    expect(isValidTrackingNumber("794644790138")).toBe(true);
    for (const bad of ["", "12", "abc def", "x".repeat(40), null, undefined]) expect(isValidTrackingNumber(bad)).toBe(false);
    expect(fedexTrackingUrl("7946 4479 0138")).toBe("https://www.fedex.com/fedextrack/?trknbr=794644790138");
    expect(fedexTrackingUrl("12")).toBe("");
    expect(displayTrackingNumber("794644790138")).toBe("7946 4479 0138");
    expect(displayTrackingNumber("1Z999AA10123456784")).toBe("1Z999AA10123456784");
  });
});

describe("PetitionShipmentCard", () => {
  beforeEach(() => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("a single shipment: one slim row with the date, the number, Copy and the FedEx link", () => {
    render(<PetitionShipmentCard shipment={shipment} />);
    expect(screen.getByText("Your petition shipment")).toBeTruthy();
    expect(screen.getAllByTestId("petition-shipment")).toHaveLength(1);
    expect(screen.getByText(/Sent via FedEx/).textContent).toMatch(/Nov (9|10), 2026/);
    expect(screen.getByTestId("shipment-number").textContent).toBe("7946 4479 0138");
    expect(screen.queryByTestId("shipment-employee")).toBeNull();
    expect(screen.queryByTestId("shipment-toggle")).toBeNull();
    const link = screen.getByText("Track your shipment").closest("a");
    expect(link.getAttribute("href")).toBe("https://www.fedex.com/fedextrack/?trknbr=794644790138");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("copies the plain number (no spaces)", async () => {
    render(<PetitionShipmentCard shipment={shipment} />);
    fireEvent.click(screen.getByLabelText("Copy number"));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith("794644790138"));
    expect(await screen.findByText("Copied")).toBeTruthy();
  });

  it("an employer matter is ONE card with a row per employee, each naming the employee and the case", () => {
    render(<PetitionShipmentCard shipments={[employee(1, { employeeName: "Ishaan" }), employee(2), { carrier: "ups", trackingNumber: "1Z999AA10123456784", caseNumber: "B505-C", employeeName: "Not shown" }]} />);
    expect(screen.getAllByTestId("petition-shipments")).toHaveLength(1);
    expect(screen.getByText("Your petition shipments")).toBeTruthy();
    expect(screen.getByTestId("shipment-count").textContent).toBe("2 shipped");
    expect(screen.getAllByTestId("petition-shipment")).toHaveLength(2);
    expect(screen.getAllByTestId("shipment-employee").map((n) => n.textContent)).toEqual(["Ishaan", "Employee 2"]);
    expect(screen.getAllByTestId("shipment-case").map((n) => n.textContent)).toEqual(["B505-A", "B505-B"]);
    expect(screen.getAllByText("Track your shipment").map((n) => n.closest("a").getAttribute("href"))).toEqual([
      "https://www.fedex.com/fedextrack/?trknbr=794644790101",
      "https://www.fedex.com/fedextrack/?trknbr=794644790102",
    ]);
  });

  it("with many employees only the first three rows show; the rest sit behind Show all / Show fewer", () => {
    render(<PetitionShipmentCard shipments={Array.from({ length: 10 }, (_, i) => employee(i + 1))} />);
    expect(screen.getByTestId("shipment-count").textContent).toBe("10 shipped");
    expect(screen.getAllByTestId("petition-shipment")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("shipment-toggle"));
    expect(screen.getAllByTestId("petition-shipment")).toHaveLength(10);
    expect(screen.getByTestId("shipment-toggle").textContent).toMatch(/Show fewer/);
    fireEvent.click(screen.getByTestId("shipment-toggle"));
    expect(screen.getAllByTestId("petition-shipment")).toHaveLength(3);
    expect(screen.getByTestId("shipment-toggle").textContent).toMatch(/Show all 10 shipments/);
  });

  it("exactly three shipments need no toggle", () => {
    render(<PetitionShipmentCard shipments={[employee(1), employee(2), employee(3)]} />);
    expect(screen.getAllByTestId("petition-shipment")).toHaveLength(3);
    expect(screen.queryByTestId("shipment-toggle")).toBeNull();
  });

  it("an empty list falls back to the single shipment, unlabelled", () => {
    render(<PetitionShipmentCard shipment={shipment} shipments={[]} />);
    expect(screen.getAllByTestId("petition-shipment")).toHaveLength(1);
    expect(screen.queryByTestId("shipment-employee")).toBeNull();
  });

  it("renders nothing without a usable FedEx number", () => {
    for (const value of [undefined, null, {}, { carrier: "ups", trackingNumber: "794644790138" }, { carrier: "fedex", trackingNumber: "12" }, { carrier: "fedex" }]) {
      const { container, unmount } = render(<PetitionShipmentCard shipment={value} />);
      expect(container.innerHTML).toBe("");
      unmount();
    }
  });
});
