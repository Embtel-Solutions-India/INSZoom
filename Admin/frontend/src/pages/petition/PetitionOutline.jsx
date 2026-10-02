import { useState } from 'react'
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, AlertCircle, AlertTriangle, CheckCircle2, Plus, Trash2, FileText } from 'lucide-react'

const SECTION_LABELS = { cover_letter: 'Cover Letter', support_letter: 'Support Letter', personal_statement: 'Personal Statement', g28: 'Form G-28', blank_page: 'Blank Page', separator_page: 'Separator Page' }

function statusDotFor(key, validation) {
  const issues = validation?.issues || []
  if (issues.some((i) => i.sectionKey === key && i.severity === 'error')) return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
  if (issues.some((i) => i.sectionKey === key && i.severity === 'warning')) return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
}

// Hover-revealed "+" that lets a case manager insert a blank or titled
// separator page immediately after this row — anchored by key (see
// PetitionAssemblyService.applyManualInsertions), so it lands exactly where
// they clicked rather than always at a fixed spot.
function InsertPageButton({ afterKey, disabled, onInsertPage }) {
  const [open, setOpen] = useState(false)
  if (disabled) return null
  const insert = (type) => {
    setOpen(false)
    const title = type === 'separator_page' ? window.prompt('Separator page title') : ''
    if (type === 'separator_page' && title == null) return
    onInsertPage(afterKey, type, title || '')
  }
  return (
    <div className="relative shrink-0">
      <button type="button" title="Insert page after" onClick={() => setOpen((o) => !o)} className="rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary group-hover:opacity-100">
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-10 mt-1 w-44 rounded border border-border bg-card p-1 shadow-lg">
          <button type="button" onClick={() => insert('blank_page')} className="block w-full rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-secondary">Insert blank page</button>
          <button type="button" onClick={() => insert('separator_page')} className="block w-full rounded px-2 py-1.5 text-left text-xs text-foreground hover:bg-secondary">Insert separator page</button>
        </div>
      )}
    </div>
  )
}

function OutlineLink({ sectionKey, label, active, validation, onJump, isManualPage, disabled, onInsertPage, onRemovePage }) {
  return (
    <div className="group flex items-center gap-1">
      <button
        type="button"
        onClick={() => onJump(sectionKey)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${active ? 'bg-blue-50 font-medium text-blue-700' : 'text-muted-foreground hover:bg-secondary'}`}
      >
        {isManualPage ? <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : statusDotFor(sectionKey, validation)}
        <span className="truncate">{label}</span>
      </button>
      {isManualPage && !disabled && (
        <button type="button" title="Remove page" onClick={() => onRemovePage(sectionKey)} className="rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-red-600 group-hover:opacity-100">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      <InsertPageButton afterKey={sectionKey} disabled={disabled} onInsertPage={onInsertPage} />
    </div>
  )
}

function SortableExhibitRow({ exhibit, active, validation, onJump, disabled, onInsertPage }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: exhibit.key, disabled })
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }
  return (
    <div ref={setNodeRef} style={style} className={`group flex items-center gap-1 rounded-md ${active ? 'bg-blue-50' : ''}`}>
      {!disabled && (
        <button type="button" {...attributes} {...listeners} className="cursor-grab p-1 text-muted-foreground hover:text-muted-foreground active:cursor-grabbing">
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onJump(exhibit.key)}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${active ? 'font-medium text-blue-700' : 'text-muted-foreground hover:bg-secondary'}`}
      >
        {statusDotFor(exhibit.key, validation)}
        <span className="truncate">Exhibit {exhibit.label} — {exhibit.title}</span>
      </button>
      <InsertPageButton afterKey={exhibit.key} disabled={disabled} onInsertPage={onInsertPage} />
    </div>
  )
}

// Left rail: jump links for letters/forms/certifications (fixed order, not
// draggable — the ordering profile decides their position) + a @dnd-kit
// sortable list of exhibits, which ARE reorderable. Every row also carries a
// hover "+" to insert a blank/separator page right after it; manually
// inserted pages get their own remove button instead of a status dot.
export default function PetitionOutline({ pkg, validation, activeSectionKey, onJump, onReorderExhibits, onInsertPage, onRemovePage, disabled }) {
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
    <nav className="max-h-40 w-full shrink-0 overflow-y-auto border-b border-border md:max-h-none md:w-64 md:border-b-0 md:border-r bg-card p-3">
      <div className="space-y-0.5">
        {nonExhibitSections.map((section) => (
          <OutlineLink
            key={section.key}
            sectionKey={section.key}
            label={SECTION_LABELS[section.type] || section.title}
            active={activeSectionKey === section.key}
            validation={validation}
            onJump={onJump}
            isManualPage={section.type === 'blank_page' || section.type === 'separator_page'}
            disabled={disabled}
            onInsertPage={onInsertPage}
            onRemovePage={onRemovePage}
          />
        ))}
      </div>

      {exhibits.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 px-2 text-[0.68rem] font-bold uppercase tracking-wide text-muted-foreground">Exhibits</p>
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
                    onInsertPage={onInsertPage}
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
