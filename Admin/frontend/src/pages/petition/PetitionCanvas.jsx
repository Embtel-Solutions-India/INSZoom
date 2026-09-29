import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import { Trash2 } from 'lucide-react'
import FormSheet from './FormSheet'
import ExhibitSheet from './ExhibitSheet'
import LetterSheet from './LetterSheet'
import PetitionSheet from './PetitionSheet'

const LETTER_TYPES = ['cover_letter', 'support_letter', 'personal_statement']
const MANUAL_PAGE_TYPES = ['blank_page', 'separator_page']

// A user-inserted blank/titled separator page — the actual rendered content
// lives only in the assembled mailing PDF (see ExhibitService.buildStandalonePage);
// this is just a canvas placeholder so the outline's page numbering/scroll-spy
// stays consistent with what's really in the packet.
function PageInsertSheet({ section, startPage, totalPages, onPageCount, disabled, onRemovePage }) {
  useEffect(() => { onPageCount(section.key, 1) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <PetitionSheet pageNumber={startPage} totalPages={totalPages}>
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg font-semibold text-muted-foreground">{section.type === 'blank_page' ? 'Blank Page' : (section.title || 'Separator Page')}</p>
        {!disabled && (
          <button type="button" onClick={() => onRemovePage(section.key)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">
            <Trash2 className="h-3.5 w-3.5" /> Remove page
          </button>
        )}
      </div>
    </PetitionSheet>
  )
}

// The scrollable stack of "sheets" — the petition rendered in
// ordering.presentation order (letters -> forms/certifications -> exhibits),
// with page numbers computed live from each section's actual rendered page
// count (not the last-assembled mailing PDF's numbering, which is in
// ordering.mailing order and would disagree with what's on screen here).
const PetitionCanvas = forwardRef(function PetitionCanvas(
  { caseId, pkg, validation, presentationOrdering, disabled, onEditLetter, onRemovePage, branding, saveStates, onScrollSpy },
  ref
) {
  const sectionRefs = useRef({})
  const [pageCounts, setPageCounts] = useState({})

  const orderedGroups = useMemo(() => {
    const ordering = presentationOrdering?.length ? presentationOrdering : LETTER_TYPES.concat(['certification', 'form', 'exhibit'])
    const nonExhibitSections = (pkg.sections || []).filter((s) => s.type !== 'exhibit')
    const byType = {}
    nonExhibitSections.forEach((s) => { (byType[s.type] = byType[s.type] || []).push(s) })
    const groups = []
    const seenTypes = new Set()
    ordering.forEach((type) => {
      seenTypes.add(type)
      if (type === 'exhibit') {
        groups.push({ kind: 'exhibits', items: pkg.exhibitIndex || [] })
      } else if (byType[type]?.length) {
        groups.push({ kind: 'sections', items: byType[type] })
      }
    })
    // A section type this visa's ordering.presentation doesn't list (e.g. a
    // manually inserted blank/separator page, which no definition's ordering
    // profile knows about) still has to render somewhere rather than
    // silently vanish from the canvas.
    Object.entries(byType).forEach(([type, items]) => {
      if (!seenTypes.has(type)) groups.push({ kind: 'sections', items })
    })
    return groups
  }, [pkg, presentationOrdering])

  const flatItems = useMemo(() => orderedGroups.flatMap((g) => g.items.map((item) => ({ ...item, __kind: g.kind }))), [orderedGroups])

  const onPageCount = (key, count) => setPageCounts((current) => (current[key] === count ? current : { ...current, [key]: count }))

  let running = 1
  const starts = {}
  flatItems.forEach((item) => {
    starts[item.key] = running
    running += pageCounts[item.key] || 1
  })
  const totalPages = running - 1

  useImperativeHandle(ref, () => ({
    scrollToSection: (key) => {
      sectionRefs.current[key]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
  }))

  useEffect(() => {
    const handleScroll = () => {
      const positions = Object.entries(sectionRefs.current)
        .map(([key, el]) => (el ? { key, top: el.getBoundingClientRect().top } : null))
        .filter(Boolean)
      const current = positions.filter((p) => p.top <= 160).sort((a, b) => b.top - a.top)[0]
      if (current) onScrollSpy?.(current.key, starts[current.key], totalPages)
    }
    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatItems.length, totalPages])

  const draftSectionKeys = new Set((validation?.issues || []).filter((i) => i.code === 'LETTER_DRAFT_UNREVIEWED').map((i) => i.sectionKey))

  return (
    <div className="bg-muted px-6 py-10">
      {flatItems.map((item) => (
        <div key={item.key} id={`petition-section-${item.key}`} ref={(el) => { sectionRefs.current[item.key] = el }}>
          {item.__kind === 'exhibits' ? (
            <ExhibitSheet exhibit={item} startPage={starts[item.key]} totalPages={totalPages} onPageCount={onPageCount} />
          ) : MANUAL_PAGE_TYPES.includes(item.type) ? (
            <PageInsertSheet section={item} startPage={starts[item.key]} totalPages={totalPages} onPageCount={onPageCount} disabled={disabled} onRemovePage={onRemovePage} />
          ) : LETTER_TYPES.includes(item.type) ? (
            <LetterSheet
              section={item}
              exhibitIndex={pkg.exhibitIndex}
              isDraft={draftSectionKeys.has(item.key)}
              disabled={disabled}
              saveState={saveStates?.[item.key]}
              onEdit={onEditLetter}
              branding={branding}
              startPage={starts[item.key]}
              totalPages={totalPages}
              onPageCount={onPageCount}
            />
          ) : (
            <FormSheet caseId={caseId} section={item} startPage={starts[item.key]} totalPages={totalPages} onPageCount={onPageCount} />
          )}
        </div>
      ))}
    </div>
  )
})

export default PetitionCanvas
