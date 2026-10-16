import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

afterEach(() => { cleanup() })

// Release 0b-2 edition screen (a section of Form Governance): only admin / team_lead see it, nobody types a URL or a quote, and "Check now" asks the
// backend to do the whole check and shows what it found. The API is faked.
const api = vi.hoisted(() => ({ editions: vi.fn(), autoCheck: vi.fn() }))
vi.mock('../services/api', () => ({ formEditionPolicyApi: { editions: (...a) => api.editions(...a), autoCheck: (...a) => api.autoCheck(...a) } }))

let mockUser = { role: 'admin' }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

import FormEditionEvidenceSection, { EVIDENCE_ROLES, outcomeOf } from './FormEditionEvidenceSection'

const gate = (over = {}) => ({ allowed: false, decision: 'held', status: 'unverified', reasons: ['no_policy'], decisionVersion: null, ...over })
const row = (over = {}) => ({ formCode: 'I-131', version: '2025-01-20', templateStatus: 'active', editionIdentifier: '2025-01-20', editionDateTrusted: true, canSubmitEvidence: true, live: true, awaitingPromotion: false, sourcePageUrl: 'https://www.uscis.gov/i-131', decision: null, gate: gate(), ...over })
const listing = () => ({ data: { success: true, data: [row(), row({ formCode: 'I-765', version: '2026-09-22', editionIdentifier: '2025-08-21', live: true }), row({ formCode: 'N-600', templateStatus: 'review', live: false, awaitingPromotion: true, editionIdentifier: null, canSubmitEvidence: false, gate: gate({ reasons: ['invalid_edition_identifier'] }) })] } })
const checked = (over = {}) => ({ data: { success: true, data: { outcome: 'accepted', formCode: 'I-131', editionIdentifier: '2025-01-20', sourceUrl: 'https://www.uscis.gov/i-131', gate: gate({ allowed: true, decision: 'accepted', status: 'verified', reasons: [] }), ...over } } })

beforeEach(() => {
  mockUser = { role: 'admin' }
  api.editions.mockReset().mockResolvedValue(listing())
  api.autoCheck.mockReset().mockResolvedValue(checked())
})

const open = async () => {
  render(<FormEditionEvidenceSection />)
  await screen.findByText('I-765')
}

describe('FormEditionEvidenceSection', () => {
  it('is for exactly admin and team_lead: every other role sees nothing and the API is never called', async () => {
    expect(EVIDENCE_ROLES).toEqual(['admin', 'team_lead'])
    for (const role of ['super_admin', 'case_manager', 'attorney', 'paralegal', 'finance', 'hr', 'client', undefined]) {
      mockUser = role ? { role } : null
      const { container, unmount } = render(<FormEditionEvidenceSection />)
      expect(container.textContent).toBe('')
      unmount()
    }
    expect(api.editions).not.toHaveBeenCalled()
    for (const role of ['admin', 'team_lead']) {
      mockUser = { role }
      const { unmount } = render(<FormEditionEvidenceSection />)
      await screen.findAllByText('I-131')
      unmount()
    }
    expect(api.editions).toHaveBeenCalledTimes(2)
  })

  it('lists every edition with its on-file state, decision and gate answer, and has nothing to type into', async () => {
    await open()
    expect(screen.getAllByText('On hold').length).toBe(3)
    expect(screen.getAllByText('no decision recorded yet').length).toBe(2)
    expect(screen.getByText('edition date unknown')).toBeTruthy()
    expect(screen.queryByPlaceholderText('https://www.uscis.gov/...')).toBeNull()
    expect(screen.queryByRole('textbox', { name: /sentence/i })).toBeNull()
    const noDate = screen.getByText('N-600').closest('tr')
    expect(within(noDate).getByRole('button', { name: 'Check now' }).disabled).toBe(true)
  })

  it('filters and searches', async () => {
    await open()
    fireEvent.change(screen.getByPlaceholderText('Search form or edition...'), { target: { value: 'i-765' } })
    expect(screen.queryByText('I-131')).toBeNull()
    expect(screen.getByText('I-765')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Search form or edition...'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Awaiting promotion' }))
    expect(screen.queryByText('I-131')).toBeNull()
    expect(screen.getByText('N-600')).toBeTruthy()
  })

  it('"Check now" sends only the form and edition, shows what the check found and refreshes the list', async () => {
    await open()
    api.editions.mockClear()
    fireEvent.click(within(screen.getByText('I-131').closest('tr')).getByRole('button', { name: 'Check now' }))
    const outcome = await screen.findByTestId('check-outcome')
    expect(api.autoCheck).toHaveBeenCalledWith('I-131', '2025-01-20')
    expect(outcome.textContent).toMatch(/explicitly says this edition is accepted/)
    expect(outcome.textContent).toMatch(/Source: https:\/\/www\.uscis\.gov\/i-131/)
    await waitFor(() => expect(api.editions).toHaveBeenCalledTimes(1))
  })

  it('says plainly when nothing was recorded (no explicit statement, fetch failure) so nobody thinks it was accepted', async () => {
    api.autoCheck.mockResolvedValueOnce(checked({ outcome: 'no_explicit_statement', gate: undefined }))
    await open()
    fireEvent.click(within(screen.getByText('I-131').closest('tr')).getByRole('button', { name: 'Check now' }))
    expect((await screen.findByTestId('check-outcome')).textContent).toMatch(/no explicit statement[^.]*nothing was recorded/)

    api.autoCheck.mockResolvedValueOnce(checked({ outcome: 'fetch_failed' }))
    fireEvent.click(within(screen.getByText('I-765').closest('tr')).getByRole('button', { name: 'Check now' }))
    await waitFor(() => expect(screen.getAllByTestId('check-outcome').length).toBe(2))
    expect(screen.getAllByTestId('check-outcome')[1].textContent).toMatch(/could not be fetched.*Nothing was recorded/)
  })

  it('a not-accepted finding is shown in red wording and every outcome has plain text', () => {
    expect(outcomeOf({ outcome: 'not_accepted' }).tone).toBe('red')
    expect(outcomeOf({ outcome: 'accepted' }).tone).toBe('green')
    for (const name of ['accepted', 'not_accepted', 'unchanged', 'no_explicit_statement', 'held_unverified', 'no_official_page', 'fetch_failed', 'no_template', 'edition_date_not_trusted', 'locked_not_accepted', 'supplement_not_listed', 'official_pdf_edition_differs']) {
      expect(outcomeOf({ outcome: name }).text.length).toBeGreaterThan(20)
    }
    expect(outcomeOf({ outcome: 'something_new' }).text).toMatch(/Nothing was recorded/)
  })

  it('shows the server message when the check is refused or fails, without crashing', async () => {
    api.autoCheck.mockRejectedValueOnce({ response: { data: { message: 'Only an admin or team lead can do this' } } })
    await open()
    fireEvent.click(within(screen.getByText('I-131').closest('tr')).getByRole('button', { name: 'Check now' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Only an admin or team lead can do this')
  })

  it('shows a load error without crashing', async () => {
    api.editions.mockReset().mockRejectedValue({ response: { data: { message: 'Not authorized' } } })
    render(<FormEditionEvidenceSection />)
    expect((await screen.findByRole('alert')).textContent).toBe('Not authorized')
  })
})
