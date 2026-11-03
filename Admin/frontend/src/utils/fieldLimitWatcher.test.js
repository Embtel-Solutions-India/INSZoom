// Owner rule 2026-11-04: no character limit on any form, ever, and numbers stay one per box. pdf.js adds boxes (with /MaxLen as maxlength) on its own
// schedule; the watcher must catch boxes that already exist, boxes added later, and a maxlength set on an existing box - remembering the box layout first.
import { describe, it, expect } from 'vitest'
import { watchFieldLimits } from './fieldLimitWatcher'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const box = ({ max, comb = false, spacing = '' }) => {
  const input = document.createElement('input')
  input.setAttribute('maxlength', String(max))
  if (comb) { input.classList.add('comb'); input.style.letterSpacing = spacing }
  return input
}

describe('watchFieldLimits - no character limit on any box', () => {
  it('lifts the limit on boxes already on the page, on boxes pdf.js adds later, and on a maxlength set afterwards', async () => {
    const page = document.createElement('div')
    const existing = box({ max: 5 })
    page.appendChild(existing)
    const stop = watchFieldLimits(page)
    expect(existing.hasAttribute('maxlength')).toBe(false)

    const layer = document.createElement('section')
    const later = box({ max: 3 })
    layer.appendChild(later)
    page.appendChild(layer) // pdf.js renders the annotation layer after the page
    await tick()
    expect(later.hasAttribute('maxlength')).toBe(false)

    existing.setAttribute('maxlength', '4') // pdf.js re-applies /MaxLen on a redraw
    await tick()
    expect(existing.hasAttribute('maxlength')).toBe(false)
    stop()
  })

  it('a one-character-per-box field keeps its box layout (numbers in their own boxes) while the text fits, and falls back for longer text', async () => {
    const page = document.createElement('div')
    const stop = watchFieldLimits(page)
    const digits = box({ max: 10, comb: true, spacing: '12px' })
    digits.value = '9354596545'
    page.appendChild(digits)
    await tick()
    expect(digits.hasAttribute('maxlength')).toBe(false)
    expect(digits.dataset.combMax).toBe('10')
    expect(digits.classList.contains('comb')).toBe(true)
    expect(digits.style.letterSpacing).toBe('12px')
    const long = box({ max: 4, comb: true, spacing: '9px' })
    long.value = 'longer than four'
    page.appendChild(long)
    await tick()
    expect(long.classList.contains('comb')).toBe(false) // too long for the boxes: shown as ordinary text, every character kept
    expect(long.style.letterSpacing).toBe('')
    stop()
  })

  it('does nothing harmful without a page', () => {
    expect(watchFieldLimits(null)).toBeUndefined()
  })
})
