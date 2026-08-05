const TIER_META = {
  A: { label: "Tier A", color: "bg-emerald-500", text: "text-emerald-700" },
  B: { label: "Tier B", color: "bg-blue-500", text: "text-blue-700" },
  C: { label: "Tier C", color: "bg-amber-500", text: "text-amber-700" },
  D: { label: "Tier D", color: "bg-slate-400", text: "text-slate-600" },
};

// Client-side PREVIEW only — mirrors the backend's own tier rules for a
// responsive live meter while answering, but is never treated as
// authoritative; the server always recomputes on submit (see
// EligibilityResults.jsx, which renders whatever POST /submit returns).
export function previewTier(criteriaAnswers, criteriaQuestions, scoringConfig) {
  const threshold = scoringConfig?.filingStrengthThreshold ?? 2;
  const developable = scoringConfig?.developableThreshold ?? 1;
  const metCount = criteriaQuestions.filter((q) => (criteriaAnswers[q.key] ?? -1) >= threshold).length;
  const tierRules = scoringConfig?.tierRules || [
    { tier: "A", minCriteriaMet: 4, maxCriteriaMet: null },
    { tier: "B", minCriteriaMet: 3, maxCriteriaMet: 3 },
    { tier: "C", minCriteriaMet: 2, maxCriteriaMet: 2 },
    { tier: "D", minCriteriaMet: 0, maxCriteriaMet: 1 },
  ];
  const matched = tierRules.find((rule) => metCount >= rule.minCriteriaMet && (rule.maxCriteriaMet === null || rule.maxCriteriaMet === undefined || metCount <= rule.maxCriteriaMet));
  return { tier: matched?.tier || "D", metCount, developableCount: criteriaQuestions.filter((q) => criteriaAnswers[q.key] === developable).length };
}

function statusOf(value, threshold, developable) {
  if (value === undefined || value === null) return "pending";
  if (value >= threshold) return "met";
  if (value === developable) return "partial";
  return "pending";
}

// Sticky sidebar (desktop) / collapsible drawer (mobile) — every criterion
// as pending/partial/met + a live tier preview.
export default function LiveTracker({ criteriaQuestions, criteriaAnswers, scoringConfig, className = "" }) {
  const threshold = scoringConfig?.filingStrengthThreshold ?? 2;
  const developable = scoringConfig?.developableThreshold ?? 1;
  const { tier, metCount } = previewTier(criteriaAnswers, criteriaQuestions, scoringConfig);
  const meta = TIER_META[tier];

  return (
    <div className={`rounded-2xl border border-slate-200 p-5 ${className}`}>
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Your live snapshot</p>
      <div className="flex items-center gap-3 mb-4">
        <span className={`w-3 h-3 rounded-full ${meta.color}`} aria-hidden="true" />
        <span className={`text-sm font-extrabold ${meta.text}`}>{meta.label} preview</span>
        <span className="text-xs text-slate-400 ml-auto">{metCount}/{criteriaQuestions.length} strong</span>
      </div>
      <ul className="space-y-2">
        {criteriaQuestions.map((q) => {
          const status = statusOf(criteriaAnswers[q.key], threshold, developable);
          const dot = status === "met" ? "bg-emerald-500" : status === "partial" ? "bg-amber-400" : "bg-slate-300";
          const label = status === "met" ? "Strong" : status === "partial" ? "Developing" : "Not answered";
          return (
            <li key={q.key} className="flex items-center gap-2 text-xs">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
              <span className="text-slate-600 truncate flex-1">{q.label}</span>
              <span className="text-slate-400 shrink-0">{label}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-[0.68rem] text-slate-400 mt-4 leading-relaxed">
        This is a live preview. Your final result is calculated when you submit.
      </p>
    </div>
  );
}
