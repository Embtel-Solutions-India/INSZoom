import { useState, useRef, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import StatBadge from './StatBadge'
import { stageToneColor, stageToneKey, caseToneStyle, mixedMatterTone, TONE_ORDER } from '../../utils/stageTone'

const NEUTRAL_SEGMENT = 'rgba(148, 163, 184, 0.55)'

// The stages of an employer matter whose employees are in different pipeline stages, or null when there is nothing to break down.
export function stageBreakdown(caseItem) {
  const summary = caseItem?.pipelineStageSummary
  if (!Array.isArray(summary) || summary.length < 2) return null
  // coloured stages first in pipeline order (Submitted, RFE, Approved, Disapproved), the rest after
  const rank = (name) => { const i = TONE_ORDER.indexOf(stageToneKey(name)); return i < 0 ? TONE_ORDER.length : i }
  const stages = [...summary].sort((a, b) => rank(a.name) - rank(b.name))
  return { count: caseItem.pipelineEmployeeCount, stages }
}

// Themed hover card with the stage breakdown. Rendered in a portal with fixed positioning so table cells / cards never clip it.
export function StageHoverTip({ caseItem, children, className = '' }) {
  const breakdown = stageBreakdown(caseItem)
  const anchorRef = useRef(null)
  const tipRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!open || !anchorRef.current || !tipRef.current) return
    const anchor = anchorRef.current.getBoundingClientRect()
    const tip = tipRef.current.getBoundingClientRect()
    const margin = 8
    const left = Math.min(Math.max(margin, anchor.left), window.innerWidth - tip.width - margin)
    const below = anchor.bottom + 6
    const top = below + tip.height > window.innerHeight - margin ? Math.max(margin, anchor.top - tip.height - 6) : below
    setPos({ top, left })
  }, [open])

  if (!breakdown) return children
  return (
    <span
      ref={anchorRef}
      className={`inline-flex ${className}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open && createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="pointer-events-none min-w-[11rem] max-w-[18rem] rounded-xl border border-border bg-card px-3 py-2.5 text-left shadow-lg"
        >
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {breakdown.count} employees
          </div>
          <ul className="space-y-1">
            {breakdown.stages.map((item) => (
              <li key={item.name} className="flex items-center justify-between gap-4 text-xs normal-case text-foreground">
                <span className="flex items-center gap-2">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stageToneColor(item.name) || NEUTRAL_SEGMENT }} />
                  {item.name}
                </span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-muted-foreground">{item.count}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body
      )}
    </span>
  )
}

// Always-visible colour bar: one part per stage, as wide as its employee count.
export function StageBar({ stages, className = '' }) {
  return (
    <span className={`flex h-1.5 w-full min-w-[4rem] gap-0.5 overflow-hidden rounded-full ${className}`} aria-hidden="true">
      {stages.map((item) => (
        <span key={item.name} style={{ flexGrow: item.count, backgroundColor: stageToneColor(item.name) || NEUTRAL_SEGMENT, opacity: 0.75 }} />
      ))}
    </span>
  )
}

// A case's stage in a list. An employer matter whose employees are in different pipeline stages shows one "N employees" pill with
// a colour bar under it (a part per employee stage, always visible; breakdown on hover); when they all share one stage, that single
// stage, coloured when it is Submitted / RFE / Approved / Disapproved.
export default function StageSummary({ caseItem, className = '' }) {
  const breakdown = stageBreakdown(caseItem)
  if (breakdown) {
    return (
      <StageHoverTip caseItem={caseItem} className={className}>
        <span className="inline-flex flex-col items-stretch gap-1">
          <StatBadge value={`${breakdown.count} employees`} kind="stage" className="normal-case" style={mixedMatterTone(caseItem) ? caseToneStyle(caseItem, mixedMatterTone(caseItem) === 'orange' ? 'PWD under process' : 'Submitted') : undefined} />
          {breakdown.stages.some((item) => stageToneColor(item.name)) ? <StageBar stages={breakdown.stages} /> : null}
        </span>
      </StageHoverTip>
    )
  }
  const stage = caseItem?.pipelineStage || caseItem?.stage
  return <StatBadge value={stage} kind="stage" className={className} style={caseToneStyle(caseItem, caseItem?.pipelineStageKey || stage)} />
}
