// Two colours for a case's pipeline stage, nothing else is coloured:
//   blue - the case has been filed or has an outcome: Submitted, Receipt tracking, RFE, Approved, Disapproved / Rejected, Feedback
//          (shown green in the dark theme)
//   red  - the case is On Hold
//   logo - a Completed case (status), in the Immiglance logo blue, in the dark theme only (the day theme keeps its stage colour);
//          listed after the others
// A stage in neither list (Case Onboarded, Docs checklist, Draft ready ...) is a case still being worked on and stays white.
// Matches the stage key (submitted_fedex, status_approved, ...) or its name. The colours are CSS variables (index.css) so the
// theme switches them without any re-render: --tone-blue-rgb / --tone-blue-text, --tone-red-rgb / --tone-red-text.
const TONE_VARS = {
  blue: { rgb: 'var(--tone-blue-rgb)', text: 'rgb(var(--tone-blue-rgb))' },
  red: { rgb: 'var(--tone-red-rgb)', text: 'rgb(var(--tone-red-rgb))' },
}

// coloured stages first when a matter's employees are spread across stages
export const TONE_ORDER = ['blue', 'red']

export function stageToneKey(stage) {
  const text = String(stage || '').toLowerCase()
  if (!text) return null
  if (/hold/.test(text)) return 'red'
  if (/submitted|receipt|(^|[^a-z])rfe([^a-z]|$)|approv|reject|feedback/.test(text)) return 'blue'
  return null
}

// inline style for a pill / chip, or undefined for a white stage
export function stageToneStyle(stage) {
  const tone = TONE_VARS[stageToneKey(stage)]
  if (!tone) return undefined
  return { backgroundColor: `rgba(${tone.rgb}, 0.13)`, borderColor: `rgba(${tone.rgb}, 0.38)`, color: tone.text }
}

// Whole-line tint for a list row: a soft wash of the colour across the row (no edge line). A matter whose
// employees are in different stages has no single colour, so its row stays white (its colour bar shows the mix).
export function rowToneStyle(caseItem) {
  const stage = caseItem?.pipelineStageKey || caseItem?.pipelineStage
  if (caseItem?.status === 'completed') {
    // --completed-row-bg exists only in the dark theme (index.css); in the day theme the var() falls back to the stage tint
    const own = Array.isArray(caseItem?.pipelineStageSummary) && caseItem.pipelineStageSummary.length > 1 ? undefined : TONE_VARS[stageToneKey(stage)]
    return { '--stage-bg': own ? `rgba(${own.rgb}, 0.09)` : 'transparent', backgroundColor: 'var(--completed-row-bg, var(--stage-bg))' }
  }
  if (Array.isArray(caseItem?.pipelineStageSummary) && caseItem.pipelineStageSummary.length > 1) return undefined
  const tone = TONE_VARS[stageToneKey(caseItem?.pipelineStageKey || caseItem?.pipelineStage)]
  if (!tone) return undefined
  return { backgroundColor: `rgba(${tone.rgb}, 0.09)` }
}

// the solid colour (dots, bars, card edge) or null
export function stageToneColor(stage) {
  return TONE_VARS[stageToneKey(stage)]?.text || null
}

// the pill of a case in a list: a Completed case takes the logo colour in the dark theme, otherwise its stage's colour
export function caseToneStyle(caseItem, stage) {
  const own = stageToneStyle(stage)
  if (caseItem?.status !== 'completed') return own
  // the --completed-pill-* vars exist only in the dark theme (index.css); in the day theme they fall back to the stage's own colours
  return {
    '--stage-pill-bg': own?.backgroundColor || 'transparent',
    '--stage-pill-border': own?.borderColor || 'hsl(var(--border))',
    '--stage-pill-text': own?.color || 'hsl(var(--foreground))',
    backgroundColor: 'var(--completed-pill-bg, var(--stage-pill-bg))',
    borderColor: 'var(--completed-pill-border, var(--stage-pill-border))',
    color: 'var(--completed-pill-text, var(--stage-pill-text))',
  }
}
