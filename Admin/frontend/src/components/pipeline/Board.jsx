import { useMemo, useState, useCallback } from 'react'
import { DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, pointerWithin, rectIntersection } from '@dnd-kit/core'
import Column from './Column'
import { CardView } from './Card'

// Prefer the column under the pointer; fall back to overlap so a drop near an edge still lands somewhere sensible.
const collisionDetection = (args) => {
  const hits = pointerWithin(args)
  return hits.length ? hits : rectIntersection(args)
}

const matches = (card, query) =>
  [card.clientName, card.employerName, card.beneficiaryName, card.caseNumber, card.clientEmail, card.visaType].some((value) => String(value || '').toLowerCase().includes(query))

export default function Board({ columns, onMove, onOpen, onPageChange, pageLoading = {}, pageOf = () => 0, onDragStateChange, filter = '' }) {
  const [activeId, setActiveId] = useState(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // a plain click still opens the case
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }), // long-press to drag; normal scrolling still works
    useSensor(KeyboardSensor)
  )

  const stages = useMemo(() => columns.map((c) => ({ key: c.key, name: c.name })), [columns])
  const query = filter.trim().toLowerCase()
  const activeCard = useMemo(() => (activeId ? columns.flatMap((c) => c.cards).find((card) => card._id === activeId) : null), [activeId, columns])

  const handleDragStart = useCallback((event) => {
    setActiveId(event.active.id)
    onDragStateChange(true)
  }, [onDragStateChange])

  const handleDragEnd = useCallback((event) => {
    setActiveId(null)
    if (event.over) onMove(event.active.id, event.over.id)
    onDragStateChange(false)
  }, [onMove, onDragStateChange])

  const handleDragCancel = useCallback(() => {
    setActiveId(null)
    onDragStateChange(false)
  }, [onDragStateChange])

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetection} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div className="flex min-h-[calc(100vh-13rem)] items-stretch gap-3 overflow-x-auto pb-3">
        {columns.map((column, index) => (
          <Column
            key={column.key}
            column={column}
            index={index}
            cards={query ? column.cards.filter((card) => matches(card, query)) : column.cards}
            stages={stages}
            onOpen={onOpen}
            onMoveTo={onMove}
            page={pageOf(column.key)}
            pageLoading={Boolean(pageLoading[column.key])}
            onPageChange={onPageChange}
            filtering={Boolean(query)}
          />
        ))}
      </div>
      {/* dropAnimation off: the card is already in its new column (optimistic), so there is nothing to animate back to. */}
      <DragOverlay dropAnimation={null}>
        {activeCard ? <CardView card={activeCard} stages={stages} isOverlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}
