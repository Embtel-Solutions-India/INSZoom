import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom'
import { recordLocation, getCaseOrigin, resetCaseOrigin, useCaseOriginTracker, useCaseOrigin } from './caseOrigin'

beforeEach(() => resetCaseOrigin())

describe('recordLocation', () => {
  it('a case opened from Cases, Corporations or Clients remembers that list (with its filters)', () => {
    recordLocation('/crm-cases', '?status=on_hold')
    recordLocation('/crm-cases/A')
    expect(getCaseOrigin('A')).toEqual({ path: '/crm-cases?status=on_hold', label: 'Cases' })
    recordLocation('/corporations')
    recordLocation('/crm-cases/B')
    expect(getCaseOrigin('B')).toEqual({ path: '/corporations', label: 'Corporations' })
    recordLocation('/clients')
    recordLocation('/crm-cases/C')
    expect(getCaseOrigin('C')).toEqual({ path: '/clients', label: 'Clients' })
  })

  it('the same case opened later from a different list gets the new origin', () => {
    recordLocation('/corporations'); recordLocation('/crm-cases/A')
    recordLocation('/corporations'); recordLocation('/crm-cases')
    recordLocation('/crm-cases/A')
    expect(getCaseOrigin('A').label).toBe('Cases')
  })

  it('moving between a corporation and its employee keeps the original list; a tab change does not re-record', () => {
    recordLocation('/corporations'); recordLocation('/crm-cases/PARENT')
    recordLocation('/crm-cases/PARENT', '?tab=documents')
    recordLocation('/crm-cases/CHILD')
    expect(getCaseOrigin('CHILD').label).toBe('Corporations')
    recordLocation('/crm-cases/PARENT')
    expect(getCaseOrigin('PARENT').label).toBe('Corporations')
  })

  it('a case reached from anywhere else has no origin (the old type-based back button is used)', () => {
    recordLocation('/crm-cases'); recordLocation('/dashboard'); recordLocation('/crm-cases/A')
    expect(getCaseOrigin('A')).toBeNull()
    expect(getCaseOrigin('never-opened')).toBeNull()
    recordLocation('/recycle-bin'); recordLocation('/crm-cases/B')
    expect(getCaseOrigin('B')).toBeNull()
  })
})

function Probe() { const origin = useCaseOrigin('A'); return <p data-testid="label">{origin ? `Back to ${origin.label}` : 'fallback'}</p> }
function Shell() {
  useCaseOriginTracker()
  const navigate = useNavigate()
  return (
    <div>
      <button onClick={() => navigate('/corporations')}>corp</button>
      <button onClick={() => navigate('/crm-cases')}>cases</button>
      <button onClick={() => navigate('/crm-cases/A')}>open</button>
      <Routes><Route path="/crm-cases/:id" element={<Probe />} /><Route path="*" element={<p>list</p>} /></Routes>
    </div>
  )
}

describe('useCaseOriginTracker in a router', () => {
  it('the case page shows the list it was opened from, every time it is reopened', () => {
    render(<MemoryRouter initialEntries={['/corporations']}><Shell /></MemoryRouter>)
    act(() => screen.getByText('open').click())
    expect(screen.getByTestId('label').textContent).toBe('Back to Corporations')
    act(() => screen.getByText('cases').click())
    act(() => screen.getByText('open').click())
    expect(screen.getByTestId('label').textContent).toBe('Back to Cases')
  })
})
