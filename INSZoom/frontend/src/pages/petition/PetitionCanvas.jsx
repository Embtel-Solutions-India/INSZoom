import { useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react'
import FormSheet from './FormSheet'
import ExhibitSheet from './ExhibitSheet'
import LetterSheet from './LetterSheet'

const LETTER_TYPES = ['cover_letter', 'support_letter', 'personal_statement']

// The scrollable stack of "sheets" — the petition rendered in
// ordering.presentation order (letters -> forms/certifications -> exhibits),
// with page numbers computed live from each section's actual rendered page
// count (not the last-assembled mailing PDF's numbering, which is in
// ordering.mailing order and would disagree with what's on screen here).
const PetitionCanvas = forwardRef(function PetitionCanvas(
  { caseId, pkg, validation, presentationOrdering, disabled, onEditLetter, saveStates, onScrollSpy },
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
    ordering.forEach((type) => {
      if (type === 'exhibit') {
        groups.push({ kind: 'exhibits', items: pkg.exhibitIndex || [] })
      } else if (byType[type]?.length) {
        groups.push({ kind: 'sections', items: byType[type] })
      }
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
    <div className="bg-gray-200 px-6 py-10">
      {flatItems.map((item) => (
        <div key={item.key} id={`petition-section-${item.key}`} ref={(el) => { sectionRefs.current[item.key] = el }}>
          {item.__kind === 'exhibits' ? (
            <ExhibitSheet exhibit={item} startPage={starts[item.key]} totalPages={totalPages} onPageCount={onPageCount} />
          ) : LETTER_TYPES.includes(item.type) ? (
            <LetterSheet
              section={item}
              exhibitIndex={pkg.exhibitIndex}
              isDraft={draftSectionKeys.has(item.key)}
              disabled={disabled}
              saveState={saveStates?.[item.key]}
              onEdit={onEditLetter}
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
