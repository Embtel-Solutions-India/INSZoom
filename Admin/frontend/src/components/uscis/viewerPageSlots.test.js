import { describe, expect, it } from 'vitest'
import { buildPageSlots, pageMismatch } from './viewerPageSlots'

describe('buildPageSlots', () => {
  it('uses the header page map and clamps to the real pdf page count', () => {
    const headerPageMap = [{ slot: 1, parentPage: 20 }, { slot: 2, parentPage: 21 }, { slot: 3, parentPage: 22 }]
    const slots = buildPageSlots({ viewerPageConstraint: null, headerPageMap, pdfPageCount: 3, fieldsByPage: new Map(), pageDimensionsByNumber: new Map() })
    expect(slots).toEqual([
      { slot: 1, parentPage: 20 },
      { slot: 2, parentPage: 21 },
      { slot: 3, parentPage: 22 },
    ])
  })

  it('clamps a stale/oversized header map to the pdf that actually loaded, and flags the mismatch', () => {
    const headerPageMap = Array.from({ length: 8 }, (_, i) => ({ slot: i + 1, parentPage: 13 + i }))
    const slots = buildPageSlots({ viewerPageConstraint: null, headerPageMap, pdfPageCount: 3, fieldsByPage: new Map(), pageDimensionsByNumber: new Map() })
    expect(slots).toEqual([
      { slot: 1, parentPage: 13 },
      { slot: 2, parentPage: 14 },
      { slot: 3, parentPage: 15 },
    ])
    expect(pageMismatch(slots, 3, 8)).toMatch(/Expected 8/)
  })

  it('falls back to viewerPageConstraint.pageMap when no header map is present', () => {
    const viewerPageConstraint = { type: 'component', pageMap: [{ slot: 1, parentPage: 21 }, { slot: 2, parentPage: 22 }] }
    const slots = buildPageSlots({ viewerPageConstraint, headerPageMap: null, pdfPageCount: 2, fieldsByPage: new Map(), pageDimensionsByNumber: new Map() })
    expect(slots).toEqual([{ slot: 1, parentPage: 21 }, { slot: 2, parentPage: 22 }])
  })

  it('treats core as an identity subset over the full parent pdf', () => {
    const viewerPageConstraint = { type: 'core', pages: [1, 2, 3, 4, 5, 6, 7, 8] }
    const slots = buildPageSlots({ viewerPageConstraint, headerPageMap: null, pdfPageCount: 38, fieldsByPage: new Map(), pageDimensionsByNumber: new Map() })
    expect(slots).toEqual([1, 2, 3, 4, 5, 6, 7, 8].map((p) => ({ slot: p, parentPage: p })))
  })

  it('falls back to identity over known pages for a full/legacy form', () => {
    const fieldsByPage = new Map([[1, []], [2, []], [3, []]])
    const slots = buildPageSlots({ viewerPageConstraint: { type: 'full' }, headerPageMap: null, pdfPageCount: 0, fieldsByPage, pageDimensionsByNumber: new Map() })
    expect(slots).toEqual([{ slot: 1, parentPage: 1 }, { slot: 2, parentPage: 2 }, { slot: 3, parentPage: 3 }])
  })

  it('does not clamp when pdfPageCount is 0 (pdf not loaded yet)', () => {
    const headerPageMap = [{ slot: 1, parentPage: 20 }, { slot: 2, parentPage: 21 }]
    const slots = buildPageSlots({ viewerPageConstraint: null, headerPageMap, pdfPageCount: 0, fieldsByPage: new Map(), pageDimensionsByNumber: new Map() })
    expect(slots).toEqual(headerPageMap)
  })
})

describe('pageMismatch', () => {
  it('returns null when everything agrees', () => {
    const slots = [{ slot: 1, parentPage: 21 }, { slot: 2, parentPage: 22 }]
    expect(pageMismatch(slots, 2, 2)).toBeNull()
  })
})
