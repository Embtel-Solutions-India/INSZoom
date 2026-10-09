import { memo, useState } from 'react'
import { ghlApi } from '../../services/api'
import { useDraggable } from '@dnd-kit/core'
import { AlertTriangle, GripVertical } from 'lucide-react'

const PRIORITY_DOT = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-slate-300',
}

// What a card looks like. Shared by the in-column card and the drag overlay so
// the card under the pointer is pixel-identical to the one it came from.
export function CardView({ card, stages, onMoveTo, isOverlay = false }) {
  const isEmployee = card.caseRole === 'employee'
  // Admin-only: a card whose change could not reach GoHighLevel can be retried right here (the backend retries by itself too).
  const [retry, setRetry] = useState('')
  const retryNow = async (event) => {
    event.stopPropagation()
    setRetry('sending')
    try { await ghlApi.retryJob(card.failedJobId); setRetry('queued') } catch { setRetry('error') }
  }
  const isFamily = Boolean(card.isFamily)
  // An employee card is not a named person until the employer identifies them.
  const title = card.employeeIdentified === false ? 'Employee, not identified yet' : (card.clientName || 'Unnamed client')
  const sourceLabel = card.category === 'non_immigrant' ? 'Non-Immigrant pipeline' : card.category === 'immigrant' ? 'Immigrant pipeline' : ''
  return (
    <div
      className={`group relative rounded-lg border border-border bg-card p-3 shadow-sm ${isOverlay ? 'cursor-grabbing shadow-lg ring-2 ring-primary/40' : 'hover:border-primary/40'}`}
      title={sourceLabel}
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[card.priority] || PRIORITY_DOT.medium}`} title={`Priority: ${card.priority || 'medium'}`} />
            <p className={`truncate text-sm font-semibold ${card.employeeIdentified === false ? 'italic text-muted-foreground' : 'text-foreground'}`}>{title}</p>
          </div>
          {card.employerName ? <p className="mt-0.5 truncate text-xs font-medium text-foreground/80" title="Employer">{card.employerName}</p> : null}
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{card.caseNumber}</p>
          {isFamily ? (
            <p className={`truncate text-xs ${card.beneficiaryIdentified ? 'text-foreground/80' : 'italic text-muted-foreground'}`} title="Beneficiary">
              {card.beneficiaryIdentified ? `Beneficiary: ${card.beneficiaryName}` : 'Beneficiary: not identified yet'}
            </p>
          ) : card.clientEmail ? <p className="truncate text-xs text-muted-foreground">{card.clientEmail}</p> : isEmployee ? null : <p className="text-xs italic text-muted-foreground">No email</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {card.visaSelectionRequired ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[0.7rem] font-medium text-amber-800">Visa required</span>
            ) : card.visaType ? (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[0.7rem] font-medium text-primary">{card.visaType}</span>
            ) : null}
            {card.assigneeName ? <span className="truncate text-[0.7rem] text-muted-foreground">{card.assigneeName}</span> : null}
            {card.syncStatus === 'FAILED' ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[0.7rem] font-medium text-red-700" title="This change could not be sent to GoHighLevel. It will keep being retried; an admin can review it.">
                <AlertTriangle className="h-3 w-3" /> Failed to sync
              </span>
            ) : null}
            {card.syncStatus === 'FAILED' && card.failedJobId && !isOverlay ? (
              <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={retryNow} disabled={retry === 'sending' || retry === 'queued'} className="rounded-full border border-red-200 px-2 py-0.5 text-[0.7rem] font-medium text-red-700 hover:bg-red-50 disabled:opacity-60" data-testid="retry-sync">
                {retry === 'queued' ? 'Retry queued' : retry === 'sending' ? 'Retrying…' : retry === 'error' ? 'Retry failed — try again' : 'Retry'}
              </button>
            ) : null}
          </div>
        </div>
      </div>

      {/* Keyboard / touch alternative to dragging. */}
      {!isOverlay && onMoveTo ? (
        <select
          aria-label={`Move ${card.clientName || 'case'} to stage`}
          value={card.unifiedStageKey || ''}
          onChange={(event) => onMoveTo(card._id, event.target.value)}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          className="mt-2 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground opacity-0 transition-opacity focus:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100"
        >
          {stages.map((stage) => (
            <option key={stage.key} value={stage.key}>{stage.name}</option>
          ))}
        </select>
      ) : null}
    </div>
  )
}

function Card({ card, stages, onOpen, onMoveTo }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: card._id, data: { columnKey: card.unifiedStageKey } })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card._id)}
      className={`touch-manipulation outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${isDragging ? 'opacity-30' : 'cursor-grab'}`}
    >
      <CardView card={card} stages={stages} onMoveTo={onMoveTo} />
    </div>
  )
}

// Cards re-render only when their own data changes, so dragging one card never repaints the rest of a large board.
export default memo(Card, (prev, next) => prev.card === next.card && prev.stages === next.stages)
