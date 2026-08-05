// Top progress bar + step count — always visible so the prospect never
// loses their place. `step` is 1-indexed against `totalSteps`.
export default function QuizProgress({ step, totalSteps, label }) {
  const pct = Math.min(100, Math.round((step / totalSteps) * 100));
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
          Step {step} of {totalSteps}
        </span>
        {label && <span className="text-xs font-semibold text-slate-500">{label}</span>}
      </div>
      <div
        className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%`, backgroundColor: "var(--eligibility-accent, #C6A15B)" }}
        />
      </div>
    </div>
  );
}
