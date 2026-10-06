import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, Link, useNavigate } from 'react-router-dom'
import useScrollRestoration, { restoreScrollTo } from './useScrollRestoration'

let scrollY
let pageHeight

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'setTimeout', 'clearTimeout'] })
  scrollY = 0
  pageHeight = 5000
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => pageHeight })
  // a real browser clamps the scroll position to the page height
  window.scrollTo = vi.fn((x, y) => { scrollY = Math.max(0, Math.min(y, pageHeight - window.innerHeight)) })
})
afterEach(() => { vi.useRealTimers() })

const advance = (ms) => act(async () => { vi.advanceTimersByTime(ms) })

describe('restoreScrollTo', () => {
  it('returns to the exact position and then stops touching the scroll', async () => {
    const done = vi.fn()
    restoreScrollTo(1200, { onDone: done })
    await advance(100)
    expect(scrollY).toBe(1200)
    await advance(400)
    expect(done).toHaveBeenCalledTimes(1)
    const calls = window.scrollTo.mock.calls.length
    scrollY = 1300 // the user scrolls afterwards
    await advance(1000)
    expect(window.scrollTo.mock.calls.length).toBe(calls) // never yanked again
    expect(scrollY).toBe(1300)
  })

  it('waits for a list that is still loading, then lands on the exact spot', async () => {
    pageHeight = 900 // loading state: the page is short
    restoreScrollTo(1200)
    await advance(300)
    expect(scrollY).toBeLessThan(1200)
    pageHeight = 5000 // rows arrived
    await advance(300)
    expect(scrollY).toBe(1200)
  })

  it('gives up immediately when the user scrolls or presses a key', async () => {
    pageHeight = 900
    const done = vi.fn()
    restoreScrollTo(1200, { onDone: done })
    await advance(100)
    window.dispatchEvent(new Event('wheel'))
    await advance(50)
    expect(done).toHaveBeenCalled()
    pageHeight = 5000
    await advance(500)
    expect(scrollY).toBeLessThan(1200)
  })

  it('target 0 simply goes to the top', () => {
    scrollY = 700
    restoreScrollTo(0)
    expect(scrollY).toBe(0)
  })

  it('never keeps trying forever', async () => {
    pageHeight = 900
    const done = vi.fn()
    restoreScrollTo(4000, { onDone: done })
    await advance(5000)
    expect(done).toHaveBeenCalledTimes(1)
  })
})

describe('useScrollRestoration (router)', () => {
  function Shell() {
    useScrollRestoration()
    return null
  }
  let navigateRef
  function Nav() { navigateRef = useNavigate(); return null }
  const mount = () => render(
    <MemoryRouter initialEntries={['/crm-cases']}>
      <Shell />
      <Nav />
      <Link to="/crm-cases/123">detail</Link>
      <Routes><Route path="*" element={null} /></Routes>
    </MemoryRouter>,
  )

  it('browser back to the list restores where you were; opening a new page starts at the top', async () => {
    mount()
    await advance(50)
    scrollY = 1800
    window.dispatchEvent(new Event('scroll')) // user scrolled the list
    act(() => navigateRef('/crm-cases/123')) // open a case
    await advance(50)
    expect(scrollY).toBe(0) // a new page starts at the top
    act(() => navigateRef(-1)) // browser back
    await advance(400)
    expect(scrollY).toBe(1800)
  })

  it('a "Back to Cases" link (a normal navigation to the parent list) also returns to the same spot', async () => {
    mount()
    await advance(50)
    scrollY = 2400
    window.dispatchEvent(new Event('scroll'))
    act(() => navigateRef('/crm-cases/123'))
    await advance(50)
    act(() => navigateRef('/crm-cases')) // PUSH to the parent list
    await advance(400)
    expect(scrollY).toBe(2400)
  })

  it('navigating to an unrelated page does not inherit an old scroll position', async () => {
    mount()
    await advance(50)
    scrollY = 2400
    window.dispatchEvent(new Event('scroll'))
    act(() => navigateRef('/tasks'))
    await advance(400)
    expect(scrollY).toBe(0)
  })
})
