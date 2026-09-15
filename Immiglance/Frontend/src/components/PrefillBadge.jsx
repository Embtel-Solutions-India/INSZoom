import { IconAlertTriangle, IconSparkles } from "../utils/iconComponents";

// Small badge shown under a questionnaire field that was auto-filled from an
// uploaded document (passport, offer letter, business registration, etc. — any
// document type). `meta` is one item from documentIntelligenceApi.casePrefillSummary()
// or an Answer's mappingOutput: { confidenceScore, status, existingValue, ... }.
export default function PrefillBadge({ meta, onAccept, onReject, className = "" }) {
  if (!meta || meta.status !== "pending") return null;
  const pct = Math.max(0, Math.min(100, Math.round(meta.confidenceScore || 0)));
  const isConflict = meta.existingValue !== undefined && meta.existingValue !== null && meta.existingValue !== "";

  return (
    <div className={`mt-1 flex flex-wrap items-center gap-2 text-xs ${className}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-bold ${
          isConflict ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
        }`}
        title={isConflict ? `Document suggests a different value than what's already saved (${meta.existingValue})` : "Auto-filled from an uploaded document"}
      >
        {isConflict ? <IconAlertTriangle size={12} className="text-amber-700" /> : <IconSparkles size={12} className="text-emerald-700" />} {isConflict ? "Document conflict" : "Auto-filled"} · {pct}%
      </span>
      {onAccept && (
        <button type="button" onClick={onAccept} className="font-bold text-emerald-700 hover:underline">
          {isConflict ? "Use document value" : "Confirm"}
        </button>
      )}
      {onReject && (
        <button type="button" onClick={onReject} className="font-bold text-slate-500 hover:underline">
          {isConflict ? "Keep current" : "Clear"}
        </button>
      )}
    </div>
  );
}

export function PrefillableField({ meta, onAccept, onReject, children, className = "" }) {
  return (
    <div className={className}>
      {children}
      <PrefillBadge meta={meta} onAccept={onAccept} onReject={onReject} />
    </div>
  );
}
