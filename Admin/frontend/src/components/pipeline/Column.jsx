import { memo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import Card from './Card'

import { PAGE_SIZE } from './pageSize'

// Soft candy accents, one per stage in board order (cycled). Applied as translucent tints so they read on light and dark themes.
export const STAGE_ACCENTS = ['#8FB8E8', '#B8A1E3', '#7FC8C0', '#F2B38F', '#F4A6C0', '#B5D99C', '#E3A0D3', '#F0A5A0', '#9ED0E6', '#C9B6E8']

function Column({ column, cards, stages, index = 0, onOpen, onMoveTo, onDelete, page = 0, pageLoading = false, onPageChange, filtering }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key })
  const pageCount = Math.max(1, Math.ceil(column.total / PAGE_SIZE))
  const from = column.total ? page * PAGE_SIZE + 1 : 0
  const to = Math.min(column.total, page * PAGE_SIZE + cards.length)
  const accent = STAGE_ACCENTS[index % STAGE_ACCENTS.length]
  return (
    <section
      aria-label={`${column.name} (${column.total})`}
      className="stage-col relative flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border"
      data-over={isOver ? 'true' : 'false'}
      style={{ '--accent': accent }}
    >
      <header className="stage-col-head flex items-center justify-between px-3 py-2.5">
        <h2 className="truncate text-sm font-semibold">{column.name}</h2>
        <span className="stage-col-count ml-2 rounded-full px-2 py-0.5 text-xs font-medium">{column.total}</span>
      </header>
      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {cards.map((card) => (
          <Card key={card._id} card={card} stages={stages} onOpen={onOpen} onMoveTo={onMoveTo} onDelete={onDelete} />
        ))}
        {!cards.length ? (
          <p className="px-2 py-6 text-center text-xs opacity-60">{filtering ? 'No matching cases' : 'No cases'}</p>
        ) : null}
      </div>
      {pageCount > 1 && !filtering ? (
        <footer className="stage-col-foot flex items-center justify-between gap-1 border-t px-2 py-2 text-xs">
          <button type="button" aria-label={`Previous page of ${column.name}`} disabled={pageLoading || page <= 0} onClick={() => onPageChange(column.key, page - 1)} className="rounded-md p-1 hover:bg-white/60 disabled:opacity-40">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span aria-live="polite">{from}–{to} of {column.total} · Page {page + 1}/{pageCount}</span>
          <button type="button" aria-label={`Next page of ${column.name}`} disabled={pageLoading || page >= pageCount - 1} onClick={() => onPageChange(column.key, page + 1)} className="rounded-md p-1 hover:bg-white/60 disabled:opacity-40">
            <ChevronRight className="h-4 w-4" />
          </button>
        </footer>
      ) : null}
      {pageLoading ? (
        <div role="status" aria-label="Loading page" className="absolute inset-0 z-10 flex items-center justify-center stage-col-loading backdrop-blur-[1px]">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : null}
    </section>
  )
}

export default memo(Column)
