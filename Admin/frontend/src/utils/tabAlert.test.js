import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setTabAlert, alertTitle, alertIconSvg, countLabel, namesLabel } from './tabAlert'

const iconHref = () => document.querySelector('link[rel~="icon"]').getAttribute('href')

beforeEach(() => {
  setTabAlert({ count: 0 })
  document.head.innerHTML = '<title>Immiglance CRM</title><link rel="icon" type="image/svg+xml" href="/favicon.svg" />'
  document.title = 'Immiglance CRM'
})

describe('countLabel', () => {
  it('shows the number up to nine, then 9+', () => {
    expect(countLabel(1)).toBe('1')
    expect(countLabel(9)).toBe('9')
    expect(countLabel(10)).toBe('9+')
    expect(countLabel(250)).toBe('9+')
  })
})

describe('namesLabel', () => {
  it('names the one or two people who wrote most recently, newest first', () => {
    expect(namesLabel(['Sarah Johnson'])).toBe('Sarah Johnson')
    expect(namesLabel(['Sarah Johnson', 'Akash'])).toBe('Sarah Johnson & Akash')
  })
  it('counts a person once, however many messages they sent, and shows +N for further people', () => {
    expect(namesLabel(['Sarah', 'Sarah', 'Akash', 'Sarah'])).toBe('Sarah & Akash')
    expect(namesLabel(['Sarah', 'Akash', 'Vasu', 'Alka'])).toBe('Sarah & Akash +2')
  })
  it('ignores empty names', () => {
    expect(namesLabel(['', null, undefined])).toBe('')
    expect(namesLabel([])).toBe('')
  })
})

describe('alertTitle', () => {
  it('starts with the recent senders, then how many are unopened, then the normal title', () => {
    expect(alertTitle({ count: 1, senders: ['Sarah Johnson'], base: 'Immiglance CRM' })).toBe('Sarah Johnson · 1 unopened message')
    expect(alertTitle({ count: 3, senders: ['Sarah Johnson', 'Akash'], base: 'Immiglance CRM' })).toBe('Sarah Johnson & Akash · 3 unopened messages')
  })
  it('works without a known sender, and returns the normal title when nothing is unopened', () => {
    expect(alertTitle({ count: 2, senders: [], base: 'Immiglance CRM' })).toBe('2 unopened messages')
    expect(alertTitle({ count: 0, senders: ['Sarah'], base: 'Immiglance CRM' })).toBe('Immiglance CRM')
  })
})

describe('setTabAlert', () => {
  it('shows the ring + number on the tab icon and the recent senders in the title while something is unopened', () => {
    setTabAlert({ count: 2, senders: ['Akash', 'Vasu'] })
    expect(iconHref()).toMatch(/^data:image\/svg\+xml/)
    const svg = decodeURIComponent(iconHref())
    expect(svg).toContain('#2DA44E') // the badge
    expect(svg).not.toContain('</text>') // no number on the icon
    expect(document.title).toBe('Akash & Vasu · 2 unopened messages')
  })

  it('puts the normal icon and title back as soon as nothing is unopened', () => {
    setTabAlert({ count: 1, senders: ['Akash'] })
    setTabAlert({ count: 0 })
    expect(iconHref()).toBe('/favicon.svg')
    expect(document.querySelector('link[rel~="icon"]').getAttribute('type')).toBe('image/svg+xml')
    expect(document.title).toBe('Immiglance CRM')
  })

  it('updates the number and names in place while still unopened, and keeps the real title for later', () => {
    setTabAlert({ count: 1, senders: ['Akash'] })
    setTabAlert({ count: 12, senders: ['Vasu'] })
    expect(document.title).toBe('Vasu · 12 unopened messages')
    setTabAlert({ count: 0 })
    expect(document.title).toBe('Immiglance CRM')
  })

  it('clearing when nothing was ever shown changes nothing', () => {
    setTabAlert({ count: 0 })
    expect(iconHref()).toBe('/favicon.svg')
    expect(document.title).toBe('Immiglance CRM')
  })

  it('is safe with odd input and without an icon link in the page', () => {
    document.head.innerHTML = '<title>Immiglance CRM</title>'
    expect(() => setTabAlert()).not.toThrow()
    expect(() => setTabAlert({ count: 'x', senders: null })).not.toThrow()
    setTabAlert({ count: 1, senders: ['Akash'] })
    expect(document.querySelector('link[rel~="icon"]')).toBeTruthy()
    setTabAlert({ count: 0 })
  })
})

describe('title toggle', () => {
  it('toggles the title between the alert and the normal title every 10 seconds, and stops when nothing is unopened', () => {
    vi.useFakeTimers()
    try {
      setTabAlert({ count: 1, senders: ['Akash'] })
      expect(document.title).toBe('Akash · 1 unopened message')
      vi.advanceTimersByTime(10100)
      expect(document.title).toBe('Immiglance CRM')
      vi.advanceTimersByTime(10000)
      expect(document.title).toBe('Akash · 1 unopened message')
      setTabAlert({ count: 0 })
      vi.advanceTimersByTime(30000)
      expect(document.title).toBe('Immiglance CRM')
      expect(iconHref()).toBe('/favicon.svg')
    } finally { vi.useRealTimers() }
  })
})

describe('the icon picture', () => {
  it('the logo with the arrow centred, a small green dot in the corner and a gap around it, with no number', () => {
    const svg = alertIconSvg()
    expect(svg).toContain('#1A4589')
    expect(svg).toContain('translate(6,6) scale(0.8333)')
    expect(svg).toContain('<mask')
    expect(svg).toContain('#2DA44E')
    expect(svg).not.toContain('</text>')
    expect(svg).not.toContain('#dc2626')
  })
})
