import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react'

const SECTION_LABELS = { cover_letter: 'Cover Letter', support_letter: 'Support Letter', personal_statement: 'Personal Statement', g28: 'Form G-28' }

function statusDotFor(key, validation) {
  const issues = validation?.issues || []
  if (issues.some((i) => i.sectionKey === key && i.severity === 'error')) return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
  if (issues.some((i) => i.sectionKey === key && i.severity === 'warning')) return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
}

function OutlineLink({ sectionKey, label, active, validation, onJump }) {
  return (
    <button
      type="button"
      onClick={() => onJump(sectionKey)}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${active ? 'bg-blue-50 font-medium text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
    >
      {statusDotFor(sectionKey, validation)}
      <span className="truncate">{label}</span>
    </button>
  )
}

function SortableExhibitRow({ exhibit, active, validation, onJump, disabled }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: exhibit.key, disabled })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div ref={setNodeRef} style={style} className={`flex items-center gap-1 rounded-md ${active ? 'bg-blue-50' : ''}`}>
      {!disabled && (
        <button type="button" {...attributes} {...listeners} className="cursor-grab p-1 text-gray-400 hover:text-gray-600 active:cursor-grabbing">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onJump(exhibit.key)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${active ? 'font-medium text-blue-700' : 'text-gray-700 hover:bg-gray-100'}`}
      >
        {statusDotFor(exhibit.key, validation)}
        <span className="truncate">Exhibit {exhibit.label} — {exhibit.title}</span>
      </button>
    </div>
  )
}

// Left rail: jump links for letters/forms/certifications (fixed order, not
// draggable — the ordering profile decides their position) + a @dnd-kit
// sortable list of exhibits, which ARE reorderable.
export default function PetitionOutline({ pkg, validation, activeSectionKey, onJump, onReorderExhibits, disabled }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const nonExhibitSections = (pkg.sections || []).filter((s) => s.type !== 'exhibit')
  const exhibits = pkg.exhibitIndex || []

  const handleDragEnd = (event) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = exhibits.findIndex((e) => e.key === active.id)
    const newIndex = exhibits.findIndex((e) => e.key === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(exhibits, oldIndex, newIndex)
    onReorderExhibits(reordered.map((e) => e.key))
  }

  return (
    <nav className="w-64 shrink-0 overflow-y-auto border-r border-gray-200 bg-white p-3">
      <div className="space-y-0.5">
        {nonExhibitSections.map((section) => (
          <OutlineLink
            key={section.key}
            sectionKey={section.key}
            label={SECTION_LABELS[section.type] || section.title}
            active={activeSectionKey === section.key}
            validation={validation}
            onJump={onJump}
          />
        ))}
      </div>

      {exhibits.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 px-2 text-[0.68rem] font-bold uppercase tracking-wide text-gray-400">Exhibits</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={exhibits.map((e) => e.key)} strategy={verticalListSortingStrategy}>
              <div className="space-y-0.5">
                {exhibits.map((exhibit) => (
                  <SortableExhibitRow
                    key={exhibit.key}
                    exhibit={exhibit}
                    active={activeSectionKey === exhibit.key}
                    validation={validation}
                    onJump={onJump}
                    disabled={disabled}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}
    </nav>
  )
}
