import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "../utils/copyToClipboard";
import { cleanTrackingNumber, displayTrackingNumber, fedexTrackingUrl, isValidTrackingNumber } from "../utils/fedexTracking";

// "Your petition shipment(s)": the FedEx tracking numbers our team entered for the client's filings, each with a Copy button and a link that opens FedEx's own tracking page for it.
// ONE compact card. A single / family case has one slim row; an employer matter has one row per employee (the number is entered on the employee's case), each naming the employee and the case,
// and only the first few rows are shown - the rest sit behind "Show all", so ten employees never push the dashboard down. Renders nothing when there is no usable FedEx number
// (the case's `filingShipment(s)`, which carry nothing but the carrier, the number, the date and those labels).
const VISIBLE_ROWS = 3;

const usable = (shipment) => Boolean(shipment) && String(shipment.carrier || "").toLowerCase() === "fedex" && isValidTrackingNumber(shipment.trackingNumber);

const fmtDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
};

const Icon = ({ children, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

function ShipmentRow({ shipment, labelled }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    if (await copyTextToClipboard(cleanTrackingNumber(shipment.trackingNumber))) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    }
  };
  const sent = fmtDate(shipment.shippedAt);
  const who = shipment.employeeName || (shipment.caseNumber ? `Case ${shipment.caseNumber}` : "");
  return (
    <li data-testid="petition-shipment" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-2.5">
      <div className="min-w-0 flex-1 basis-48">
        {labelled && who ? (
          <p className="truncate text-sm font-semibold text-foreground" title={who}>
            <span data-testid="shipment-employee">{who}</span>
            {shipment.employeeName && shipment.caseNumber ? <span data-testid="shipment-case" className="ml-1.5 font-mono text-xs font-medium text-muted-foreground">{shipment.caseNumber}</span> : null}
          </p>
        ) : null}
        <p className="truncate text-xs text-muted-foreground">Sent via FedEx{sent ? ` · ${sent}` : ""}</p>
      </div>
      <p className="font-mono text-sm font-semibold text-foreground" data-testid="shipment-number" title={cleanTrackingNumber(shipment.trackingNumber)}>{displayTrackingNumber(shipment.trackingNumber)}</p>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary" aria-label={copied ? "Copied" : "Copy number"}>
          <Icon size={14}>{copied ? <path d="M20 6 9 17l-5-5" /> : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}</Icon>
          {copied ? "Copied" : "Copy"}
        </button>
        <a href={fedexTrackingUrl(shipment.trackingNumber)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90">
          Track your shipment
          <Icon size={13}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="m15 3 6 0 0 6" /><path d="M10 14 21 3" /></Icon>
        </a>
      </div>
    </li>
  );
}

export default function PetitionShipmentCard({ shipment, shipments }) {
  const [expanded, setExpanded] = useState(false);
  const list = (Array.isArray(shipments) && shipments.length ? shipments : [shipment]).filter(usable);
  if (!list.length) return null;
  const many = list.length > 1;
  const visible = expanded ? list : list.slice(0, VISIBLE_ROWS);
  const hidden = list.length - visible.length;
  return (
    <div id="petition-shipment" data-testid="petition-shipments" className="overflow-hidden rounded-lg border border-card-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon size={15}><path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></Icon>
          </span>
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{many ? "Your petition shipments" : "Your petition shipment"}</p>
        </div>
        {many ? <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-foreground" data-testid="shipment-count">{list.length} shipped</span> : null}
      </div>
      <ul className="divide-y divide-border">
        {visible.map((item) => <ShipmentRow key={`${item.caseNumber || ""}-${item.trackingNumber}`} shipment={item} labelled={many || Boolean(item.employeeName)} />)}
      </ul>
      {list.length > VISIBLE_ROWS ? (
        <button type="button" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded} data-testid="shipment-toggle" className="flex w-full items-center justify-center gap-1.5 border-t border-border px-5 py-2 text-xs font-medium text-primary hover:bg-secondary/50">
          {expanded ? "Show fewer" : `Show all ${list.length} shipments`}
          <Icon size={13}>{expanded ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}</Icon>
          {!expanded && hidden > 0 ? <span className="sr-only">{hidden} more</span> : null}
        </button>
      ) : null}
    </div>
  );
}
