import { memo } from 'react'
import { useDroppable } from '@dnd-kit/core'
import Card from './Card'

function Column({ column, cards, stages, onOpen, onMoveTo, onLoadMore, filtering }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.key })
  return (
    <section
      aria-label={`${column.name} (${column.total})`}
      className={`flex w-72 shrink-0 flex-col rounded-xl border bg-muted/40 transition-colors ${isOver ? 'border-primary bg-primary/5' : 'border-border'}`}
    >
      <header className="flex items-center justify-between px-3 py-2.5">
        <h2 className="truncate text-sm font-semibold text-foreground">{column.name}</h2>
        <span className="ml-2 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">{column.total}</span>
      </header>
      <div ref={setNodeRef} className="flex max-h-[calc(100vh-17rem)] min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {cards.map((card) => (
          <Card key={card._id} card={card} stages={stages} onOpen={onOpen} onMoveTo={onMoveTo} />
        ))}
        {!cards.length ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{filtering ? 'No matching cases' : 'No cases'}</p>
        ) : null}
        {column.hasMore && !filtering ? (
          <button type="button" onClick={() => onLoadMore(column.key)} className="rounded-md border border-dashed border-border py-1.5 text-xs text-muted-foreground hover:border-primary hover:text-primary">
            Load more ({column.total - column.cards.length} more)
          </button>
        ) : null}
      </div>
    </section>
  )
}

export default memo(Column)
