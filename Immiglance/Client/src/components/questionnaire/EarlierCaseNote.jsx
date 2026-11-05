// One login, many cases (Phase 3A): under an answer that was copied from the person's earlier case, a small grey note says where it came from -
// only while the answer is still the copied one (the last change on it is the copy; any later save hides the note).
export const PREFILL_ACTION = "prefilled_from_earlier_case";

export function earlierCaseSource(answer) {
  const history = Array.isArray(answer?.auditHistory) ? answer.auditHistory : [];
  const last = history[history.length - 1];
  return last?.action === PREFILL_ACTION ? last.changes || {} : null;
}

export default function EarlierCaseNote({ answer }) {
  const source = earlierCaseSource(answer);
  if (!source) return null;
  const from = [source.sourceVisaType, source.sourceCaseNumber].filter(Boolean).join(" · ");
  return (
    <p className="mt-1 text-xs text-muted-foreground" data-testid="earlier-case-note">
      Pre-filled from your earlier case{from ? ` (${from})` : ""}. You can change it here; your earlier case stays as it is.
    </p>
  );
}
