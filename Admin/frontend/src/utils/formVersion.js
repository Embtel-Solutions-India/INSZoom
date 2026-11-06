// The version a Case Manager sees next to a form. A USCIS form's version is its edition date ("2026-09-09"). The DOL ETA-9089 forms print no edition, so the pipeline keeps an
// INTERNAL revision counter for them ("v1", "v2"): that is bookkeeping, not something to show, so it is left out ("—"). Anything else is shown exactly as stored.
const INTERNAL_REVISION = /^v\d+$/i

export function formVersionLabel(version) {
  const text = String(version ?? '').trim()
  if (!text || INTERNAL_REVISION.test(text)) return '—'
  return text
}
