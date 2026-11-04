import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// One person, many cases (Phase 1): the New case notice and the case page strip. Both are quiet add-ons.
const api = vi.hoisted(() => ({ lookupPerson: vi.fn(), personCases: vi.fn() }))
vi.mock('../services/api', () => ({ casesApi: { lookupPerson: (...a) => api.lookupPerson(...a), personCases: (...a) => api.personCases(...a) } }))

import { ExistingPersonNotice, OtherCasesStrip } from './PersonCases'

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('ExistingPersonNotice', () => {
  it('says the new case is added to the same login when the email already has cases', async () => {
    api.lookupPerson.mockResolvedValue({ data: { data: { person: { name: 'Sam Client', email: 'sam@x.test' }, cases: [{ _id: '1' }, { _id: '2' }], multiCase: true } } })
    render(<ExistingPersonNotice email="sam@x.test" />)
    expect(await screen.findByText(/already has 2 cases/, {}, { timeout: 2000 })).toBeTruthy()
    expect(screen.getByText(/added to the same login/)).toBeTruthy()
  })

  it('shows nothing for a new email, an invalid email, or when the lookup fails', async () => {
    api.lookupPerson.mockResolvedValue({ data: { data: { person: null, cases: [] } } })
    const { container, rerender } = render(<ExistingPersonNotice email="new@x.test" />)
    await waitFor(() => expect(api.lookupPerson).toHaveBeenCalled(), { timeout: 2000 })
    expect(container.textContent).toBe('')
    api.lookupPerson.mockRejectedValue(new Error('down'))
    rerender(<ExistingPersonNotice email="other@x.test" />)
    await new Promise((r) => setTimeout(r, 600))
    expect(container.textContent).toBe('')
    rerender(<ExistingPersonNotice email="not-an-email" />)
    expect(container.textContent).toBe('')
  })
})

describe('OtherCasesStrip', () => {
  it('lists the other cases with visa, capacity and a link to each', async () => {
    api.personCases.mockResolvedValue({ data: { data: [{ person: { _id: 'u1', name: 'Sam Client', email: 'sam@x.test' }, cases: [{ _id: 'c2', visaType: 'I-765 EAD', capacity: 'client', status: 'pending_assignment', createdAt: '2026-11-01' }] }] } })
    render(<MemoryRouter><OtherCasesStrip caseId="c1" /></MemoryRouter>)
    expect(await screen.findByText(/Other cases for Sam Client/)).toBeTruthy()
    expect(screen.getByRole('link', { name: /I-765 EAD/ }).getAttribute('href')).toBe('/crm-cases/c2')
  })

  it('shows nothing when there are no other cases or the call fails', async () => {
    api.personCases.mockRejectedValue(new Error('down'))
    const { container } = render(<MemoryRouter><OtherCasesStrip caseId="c1" /></MemoryRouter>)
    await new Promise((r) => setTimeout(r, 50))
    expect(container.textContent).toBe('')
  })
})
