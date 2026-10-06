import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MemoryRouter, Routes, Route, useNavigate, useLocation, useParams } from 'react-router-dom'
import KeepAliveOutlet, { useRouteRevisit } from './KeepAliveOutlet'
import KeepTab from './KeepTab'

const mounts = {}
const revisits = {}
function Page({ name }) {
  const params = useParams()
  const location = useLocation()
  const [text, setText] = useState('')
  const seenMount = useRef(false)
  if (!seenMount.current) { seenMount.current = true; mounts[name] = (mounts[name] || 0) + 1 }
  useRouteRevisit(() => { revisits[name] = (revisits[name] || 0) + 1 })
  return (
    <div data-testid={`page-${name}`}>
      <input aria-label={`${name}-input`} value={text} onChange={(e) => setText(e.target.value)} />
      <span data-testid={`${name}-id`}>{params.id || ''}</span>
      <span data-testid={`${name}-location`}>{location.pathname}</span>
    </div>
  )
}

let go
function Nav() { go = useNavigate(); return null }

const ROUTES = ['/list', '/list/:id']
const mount = (props = {}) => render(
  <MemoryRouter initialEntries={['/list']}>
    <Nav />
    <Routes>
      <Route path="/" element={<KeepAliveOutlet routes={ROUTES} {...props} />}>
        <Route path="list" element={<Page name="list" />} />
        <Route path="list/:id" element={<Page name="detail" />} />
        <Route path="other" element={<Page name="other" />} />
      </Route>
    </Routes>
  </MemoryRouter>,
)
const nav = (to) => act(() => { go(to) })
const hiddenOf = (name) => screen.getByTestId(`page-${name}`).closest('[data-keepalive]').hidden

beforeEach(() => {
  Object.keys(mounts).forEach((k) => delete mounts[k])
  Object.keys(revisits).forEach((k) => delete revisits[k])
})

describe('KeepAliveOutlet', () => {
  it('going to a case and back keeps the list exactly as it was - mounted once, typed text intact, not reloaded', () => {
    mount()
    fireEvent.change(screen.getByLabelText('list-input'), { target: { value: 'smith' } })
    nav('/list/123')
    expect(screen.getByTestId('detail-id').textContent).toBe('123')
    expect(hiddenOf('list')).toBe(true) // hidden, not destroyed
    nav(-1)
    expect(hiddenOf('list')).toBe(false)
    expect(screen.getByLabelText('list-input').value).toBe('smith')
    expect(mounts.list).toBe(1)
    // and forth again: the case is also still there
    nav('/list/123')
    expect(mounts.detail).toBe(1)
  })

  it('different cases are kept separately, each with its own params', () => {
    mount()
    nav('/list/1')
    fireEvent.change(screen.getByLabelText('detail-input'), { target: { value: 'note on 1' } })
    nav('/list/2')
    const detailPages = screen.getAllByTestId('detail-id').map((node) => node.textContent).sort()
    expect(detailPages).toEqual(['1', '2'])
    nav('/list/1')
    const one = screen.getAllByTestId('detail-id').find((node) => node.textContent === '1').closest('[data-keepalive]')
    expect(one.hidden).toBe(false)
    expect(one.querySelector('input').value).toBe('note on 1')
    expect(mounts.detail).toBe(2)
  })

  it('a hidden page keeps the location it had and does not react to navigation elsewhere', () => {
    mount()
    nav('/list/9')
    expect(screen.getByTestId('list-location').textContent).toBe('/list')
    expect(screen.getByTestId('detail-location').textContent).toBe('/list/9')
  })

  it('pages that are not kept behave as before (unmounted when you leave)', () => {
    mount()
    nav('/other')
    expect(mounts.other).toBe(1)
    nav('/list')
    expect(screen.queryByTestId('page-other')).toBeNull()
    nav('/other')
    expect(mounts.other).toBe(2)
  })

  it('is bounded: only the most recently used pages are kept', () => {
    mount({ maxKept: 2 })
    nav('/list/1')
    nav('/list/2') // list, 1, 2 -> the oldest (list) is dropped
    nav('/list')
    expect(mounts.list).toBe(2)
  })

  describe('expiry and quiet refresh', () => {
    beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-06T10:00:00Z')) })
    afterEach(() => { vi.useRealTimers() })

    it('a page left for too long is dropped, so the next visit loads fresh data', () => {
      mount({ maxHiddenMs: 60 * 1000 })
      nav('/list/1')
      vi.setSystemTime(new Date('2026-10-06T10:05:00Z'))
      nav('/list')
      expect(mounts.list).toBe(2)
    })

    it('coming back after a short moment does NOT refresh; after a while it refreshes quietly (once)', () => {
      mount()
      nav('/list/1')
      vi.setSystemTime(new Date('2026-10-06T10:00:05Z'))
      nav('/list')
      expect(revisits.list).toBeUndefined() // 5 s away: nothing to refresh
      nav('/list/1')
      vi.setSystemTime(new Date('2026-10-06T10:02:00Z'))
      nav('/list')
      expect(revisits.list).toBe(1) // 2 minutes away: background refresh, page not remounted
      expect(mounts.list).toBe(1)
    })
  })
})

describe('KeepTab', () => {
  function Tabs() {
    const [tab, setTab] = useState('a')
    const visited = useRef(new Set(['a']))
    return (
      <div>
        <button onClick={() => setTab('a')}>A</button>
        <button onClick={() => setTab('b')}>B</button>
        <KeepTab name="a" active={tab === 'a'} visited={visited}><Page name="tabA" /></KeepTab>
        <KeepTab name="b" active={tab === 'b'} visited={visited}><Page name="tabB" /></KeepTab>
      </div>
    )
  }
  it('a tab is mounted on first visit and then stays loaded - switching never reloads it', () => {
    render(<MemoryRouter><Tabs /></MemoryRouter>)
    expect(screen.queryByTestId('page-tabB')).toBeNull() // never opened: not loaded (lazy)
    fireEvent.change(screen.getByLabelText('tabA-input'), { target: { value: 'typed' } })
    fireEvent.click(screen.getByText('B'))
    expect(mounts.tabB).toBe(1)
    expect(screen.getByTestId('page-tabA').parentElement.hidden).toBe(true)
    fireEvent.click(screen.getByText('A'))
    fireEvent.click(screen.getByText('B'))
    fireEvent.click(screen.getByText('A'))
    expect(mounts.tabA).toBe(1)
    expect(mounts.tabB).toBe(1)
    expect(screen.getByLabelText('tabA-input').value).toBe('typed')
  })
})
