import { useEffect } from "react";

export default function FedEx() {
  useEffect(() => {
    document.title = "FedEx | BAIS Immigration Portal";
  }, []);

  return (
    <div className="max-w-3xl mx-auto px-6 sm:px-10 py-12">
      <h1 className="text-2xl font-serif font-bold text-foreground mb-2">FedEx</h1>
      <p className="text-muted-foreground mb-8">Shipment tracking for your case filings.</p>

      <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
        <div className="w-12 h-12 mx-auto mb-4 rounded-lg bg-accent text-accent-foreground flex items-center justify-center">
          <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <path d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10" />
          </svg>
        </div>
        <p className="font-semibold text-foreground mb-1.5">Coming soon</p>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          FedEx shipment tracking will appear here — see live status for any package sent to or from your
          case team.
        </p>
      </div>
    </div>
  );
}
