import { useEffect } from "react";

export default function QuickBooks() {
  useEffect(() => {
    document.title = "QuickBooks | BAIS Immigration Portal";
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-6 sm:px-10 py-12">
      <h1 className="text-2xl font-serif font-bold text-foreground mb-2">QuickBooks</h1>
      <p className="text-muted-foreground mb-8">Billing sync with QuickBooks.</p>

      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-accent text-accent-foreground flex items-center justify-center">
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            <path d="M9 12a3 3 0 106 0 3 3 0 00-6 0zM12 3v3M12 18v3" />
          </svg>
        </div>
        <p className="font-semibold text-foreground mb-1.5">Coming soon</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          QuickBooks billing sync will appear here — invoices, payment status, and receipts synced directly
          from your case.
        </p>
      </div>
    </div>
  );
}
