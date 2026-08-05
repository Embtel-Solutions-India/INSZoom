import { STATUS, STATUS_META } from "../../utils/checklistStatus";

// Always icon + word together — status is never conveyed by color alone.
export default function StatusLegend({ className = "" }) {
  return (
    <div className={`flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 ${className}`} aria-label="Checklist status legend">
      <span className="mr-1 text-[0.7rem] font-bold uppercase tracking-wide text-slate-400">Status:</span>
      {Object.values(STATUS).map((key) => {
        const meta = STATUS_META[key];
        const StatusIcon = meta.icon;
        return (
          <span key={key} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.7rem] font-bold ${meta.className}`}>
            <StatusIcon />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}
