const STATUS_META = {
  pending: { label: "Not answered", dot: "bg-slate-300", text: "text-slate-400" },
  partial: { label: "Developing", dot: "bg-amber-400", text: "text-amber-600" },
  met: { label: "Strong evidence", dot: "bg-emerald-500", text: "text-emerald-600" },
};

// One O-1A/EB-1A criterion: label + help text + a 0–3 strength segmented
// control (never a slider — discrete, labeled options only) + a live
// met/partial/pending status, conveyed by icon (dot) + label + color, never
// color alone (WCAG). `question` comes verbatim from the backend
// definition — nothing here is hardcoded.
export default function CriterionCard({ question, value, onChange, metThreshold = 2, developableValue = 1 }) {
  const status = value === undefined || value === null
    ? "pending"
    : value >= metThreshold
      ? "met"
      : value === developableValue
        ? "partial"
        : "pending";
  const meta = STATUS_META[status];
  const scaleLabels = question.scaleLabels || ["None", "Developing", "Solid", "Strong"];

  return (
    <div className="rounded-2xl border border-slate-200 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <h3 className="font-bold text-slate-800 text-[0.95rem] leading-snug">{question.label}</h3>
        <span className={`shrink-0 inline-flex items-center gap-1.5 text-[0.68rem] font-bold uppercase tracking-wide ${meta.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} aria-hidden="true" />
          {meta.label}
        </span>
      </div>
      {question.helpText && <p className="text-sm text-slate-500 mb-4">{question.helpText}</p>}

      <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={question.label}>
        {scaleLabels.map((label, index) => {
          const selected = value === index;
          return (
            <button
              key={index}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(index)}
              className={`rounded-xl border px-2 py-3 text-center transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 cursor-pointer
                ${selected
                  ? "border-transparent text-white shadow-sm"
                  : "border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50"}`}
              style={selected ? { backgroundColor: "var(--eligibility-primary, #0B1F3A)" } : undefined}
            >
              <span className="block text-xs font-bold">{index}</span>
              <span className="block text-[0.65rem] mt-0.5 leading-tight">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
