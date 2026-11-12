import { useEffect, useRef, useState } from "react";
import { copyTextToClipboard } from "../utils/copyToClipboard";
import { cleanReceiptNumber, USCIS_CASE_STATUS_URL } from "../utils/uscisReceipt";

// "Track your case": the USCIS receipt number(s) our team entered for the client's online filings, each with a Copy button and a link to the USCIS case-status website
// (https://egov.uscis.gov/). Same compact card as the FedEx "Your petition shipment" card: a single / family case has one slim row; an employer matter has one row per employee (the number is
// entered on the employee's case), each naming the employee and the case, and only the first few rows show - the rest sit behind "Show all". Renders nothing when there is no valid receipt number.
const VISIBLE_ROWS = 3;

const Icon = ({ children, size = 16 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

function ReceiptRow({ receipt, labelled }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const number = cleanReceiptNumber(receipt.receiptNumber);
  const copy = async () => {
    if (await copyTextToClipboard(number)) {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    }
  };
  const who = receipt.employeeName || (receipt.caseNumber ? `Case ${receipt.caseNumber}` : "");
  return (
    <li data-testid="uscis-receipt" className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-4">
      <div className="min-w-0">
        {labelled && who ? (
          <p className="mb-1 truncate text-sm font-semibold text-foreground" title={who}>
            <span data-testid="receipt-employee">{who}</span>
            {receipt.employeeName && receipt.caseNumber ? <span data-testid="receipt-case" className="ml-1.5 font-mono text-xs font-medium text-muted-foreground">{receipt.caseNumber}</span> : null}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-sm text-muted-foreground">USCIS receipt number</span>
          <span className="font-mono text-base font-semibold tracking-wider text-foreground" data-testid="receipt-number" title={number}>{number}</span>
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground hover:bg-secondary" aria-label={copied ? "Copied" : "Copy number"}>
            <Icon size={13}>{copied ? <path d="M20 6 9 17l-5-5" /> : <><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>}</Icon>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">Enter it on the official USCIS website to see where your case stands.</p>
      </div>
      <a href={USCIS_CASE_STATUS_URL} target="_blank" rel="noopener noreferrer" data-testid="uscis-link" className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
        Track on USCIS
        <Icon size={14}><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="m15 3 6 0 0 6" /><path d="M10 14 21 3" /></Icon>
      </a>
    </li>
  );
}

export default function UscisReceiptCard({ receipt, receipts }) {
  const [expanded, setExpanded] = useState(false);
  const list = (Array.isArray(receipts) && receipts.length ? receipts : [receipt]).filter((item) => Boolean(item) && Boolean(cleanReceiptNumber(item.receiptNumber)));
  if (!list.length) return null;
  const many = list.length > 1;
  const visible = expanded ? list : list.slice(0, VISIBLE_ROWS);
  const hidden = list.length - visible.length;
  return (
    <div id="uscis-receipt" data-testid="uscis-receipts" className="overflow-hidden rounded-lg border border-card-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3.5">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon size={18}><path d="M1 3h15v13H1z" /><path d="M16 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></Icon>
          </span>
          <h3 className="text-base font-bold tracking-tight text-foreground">Track your case</h3>
        </div>
        {many ? <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-foreground" data-testid="receipt-count">{list.length} receipts</span> : null}
      </div>
      <ul className="divide-y divide-border">
        {visible.map((item) => <ReceiptRow key={`${item.caseNumber || ""}-${item.receiptNumber}`} receipt={item} labelled={many || Boolean(item.employeeName)} />)}
      </ul>
      {list.length > VISIBLE_ROWS ? (
        <button type="button" onClick={() => setExpanded((open) => !open)} aria-expanded={expanded} data-testid="receipt-toggle" className="flex w-full items-center justify-center gap-1.5 border-t border-border px-5 py-2 text-xs font-medium text-primary hover:bg-secondary/50">
          {expanded ? "Show fewer" : `Show all ${list.length} receipts`}
          <Icon size={13}>{expanded ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}</Icon>
          {!expanded && hidden > 0 ? <span className="sr-only">{hidden} more</span> : null}
        </button>
      ) : null}
    </div>
  );
}
