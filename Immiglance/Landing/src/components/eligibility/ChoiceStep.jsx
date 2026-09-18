// One single-select quiz question per screen: a label plus a stack of
// big, tappable option cards. Used for every choice-based step (category,
// visa, and the 5 fixed qualifying questions) — selecting an option calls
// onSelect immediately, so the quiz auto-advances without a separate "Next"
// click for these steps. (Going backward is handled by the quiz's own
// universal "Back" button, not repeated here.)
export default function ChoiceStep({ label, helpText, options, value, onSelect }) {
  return (
    <div>
      <p className="text-sm font-bold text-foreground mb-1">{label}</p>
      {helpText && <p className="text-sm text-muted-foreground mb-4">{helpText}</p>}
      <div className="grid gap-2.5 mt-4" role="radiogroup" aria-label={label}>
        {options.map((option) => {
          const optValue = typeof option === "string" ? option : option.value;
          const optLabel = typeof option === "string" ? option : option.label;
          const optSubtext = typeof option === "string" ? undefined : option.subtext;
          const selected = value === optValue;
          return (
            <button
              key={optValue}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onSelect(optValue)}
              className={`text-left rounded-xl border px-4 py-3.5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 cursor-pointer
                ${selected
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "border-border text-foreground hover:border-primary/40 hover:bg-secondary"}`}
            >
              <span className="font-bold text-sm block">{optLabel}</span>
              {optSubtext && (
                <span className={`text-xs block mt-0.5 ${selected ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                  {optSubtext}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
