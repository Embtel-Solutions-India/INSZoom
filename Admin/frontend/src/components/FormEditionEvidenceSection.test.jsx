import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

afterEach(() => { cleanup() })

// Release 0b-1 evidence screen (a section of Form Governance): only admin / team_lead see it, the whole submit -> verify -> confirm -> decide ->
// gate-re-run flow works, and nothing is recorded without the explicit confirmation. The API is faked.
const api = vi.hoisted(() => ({ editions: vi.fn(), submitEvidence: vi.fn(), recordDecision: vi.fn() }))
vi.mock('../services/api', () => ({ formEditionPolicyApi: { editions: (...a) => api.editions(...a), submitEvidence: (...a) => api.submitEvidence(...a), recordDecision: (...a) => api.recordDecision(...a) } }))

let mockUser = { role: 'admin' }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

import FormEditionEvidenceSection, { EVIDENCE_ROLES } from './FormEditionEvidenceSection'

const gate = (over = {}) => ({ allowed: false, decision: 'held', status: 'unverified', reasons: ['no_policy'], decisionVersion: null, ...over })
const row = (over = {}) => ({ formCode: 'I-131', version: '2025-01-20', templateStatus: 'active', editionIdentifier: '2025-01-20', editionDateTrusted: true, canSubmitEvidence: true, live: true, awaitingPromotion: false, sourcePageUrl: 'https://www.uscis.gov/i-131', decision: null, gate: gate(), ...over })
const check = (name, passed, over = {}) => ({ name, passed, category: 'unverifiable', severity: 'blocking', detail: `${name} detail`, ...over })
const verified = () => ({ overall: 'verified', failed: [], checks: [check('source_official', true), check('quote_verbatim', true), check('edition_in_snapshot', true), check('quote_names_edition', true, { severity: 'advisory' })] })
const unverified = () => ({ overall: 'unverifiable', failed: ['quote_verbatim'], checks: [check('source_official', true), check('quote_verbatim', false)] })
const submitted = (verification) => ({ data: { success: true, data: { evidenceCaseId: 'case-1', formCode: 'I-131', editionIdentifier: '2025-01-20', verification, snapshot: { id: 's1', hash: 'abcdef1234567890'.repeat(4), finalUrl: 'https://www.uscis.gov/i-131', fetchedAt: '2026-10-16T10:00:00Z', textLength: 100 }, gate: gate() } } })

beforeEach(() => {
  mockUser = { role: 'admin' }
  api.editions.mockReset().mockResolvedValue({ data: { success: true, data: [row(), row({ formCode: 'I-765', version: '2026-09-22', editionIdentifier: '2025-08-21', live: true }), row({ formCode: 'N-600', templateStatus: 'review', live: false, awaitingPromotion: true, editionIdentifier: null, canSubmitEvidence: false, gate: gate({ reasons: ['invalid_edition_identifier'] }) })] } })
  api.submitEvidence.mockReset().mockResolvedValue(submitted(verified()))
  api.recordDecision.mockReset().mockResolvedValue({ data: { success: true, data: { evidenceCaseId: 'case-1', decision: { decision: 'accepted', version: 1 }, gate: gate({ allowed: true, decision: 'accepted', status: 'verified', reasons: [] }) } } })
})

const open = async () => {
  render(<FormEditionEvidenceSection />)
  await screen.findByText('I-765')
}
const fillAndVerify = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: 'Add evidence' })[0])
  fireEvent.change(screen.getByPlaceholderText('https://www.uscis.gov/...'), { target: { value: 'https://www.uscis.gov/i-131-alert' } })
  fireEvent.change(screen.getByPlaceholderText(/Paste the sentence/), { target: { value: 'USCIS will accept the 01/20/25 edition of Form I-131 for filing.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Fetch and verify' }))
  await screen.findByTestId('verification-results')
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

  it('lists every edition with its on-file state, decision and what the gate would do (marked as not enforced)', async () => {
    await open()
    expect(screen.getByText('Gate (not enforced)')).toBeTruthy()
    expect(screen.getAllByText('Would hold').length).toBe(3)
    expect(screen.getAllByText('no decision recorded yet').length).toBe(2)
    expect(screen.getByText('edition date unknown')).toBeTruthy()
    const noDate = screen.getByText('N-600').closest('tr')
    expect(within(noDate).getByRole('button', { name: 'Add evidence' }).disabled).toBe(true)
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

  it('full flow: submit the claim, see the verification results, confirm the decision explicitly, then see the gate re-run', async () => {
    await open()
    await fillAndVerify()
    expect(api.submitEvidence).toHaveBeenCalledWith({ formCode: 'I-131', editionIdentifier: '2025-01-20', sourceUrl: 'https://www.uscis.gov/i-131-alert', quote: 'USCIS will accept the 01/20/25 edition of Form I-131 for filing.', effectiveDate: '', rejectionDate: '', graceUntil: '' })
    expect(screen.getByText('Verified')).toBeTruthy()
    expect(screen.getByText('Quote appears word-for-word in the fetched page')).toBeTruthy()
    expect(screen.getByText(/The quoted sentence itself names the edition/).closest('li').textContent).toContain('(advisory)')

    const record = screen.getByRole('button', { name: 'Record decision' })
    expect(record.disabled).toBe(true) // no rationale and no confirmation yet
    fireEvent.change(screen.getByLabelText(/Why \(kept in the audit trail\)/), { target: { value: 'Verified against the official USCIS notice.' } })
    expect(record.disabled).toBe(true) // still not confirmed
    fireEvent.click(screen.getByLabelText('I confirm: Accepted for filing for Form I-131, edition 2025-01-20'))
    expect(record.disabled).toBe(false)
    fireEvent.click(record)

    await screen.findByTestId('decision-recorded')
    expect(api.recordDecision).toHaveBeenCalledWith('case-1', { decision: 'accepted', rationale: 'Verified against the official USCIS notice.', confirmation: { confirmed: true, decision: 'accepted', formCode: 'I-131', editionIdentifier: '2025-01-20' } })
    expect(screen.getByText('Would allow')).toBeTruthy()
    expect(screen.getByText(/not enforced anywhere yet/)).toBeTruthy()
    api.editions.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(api.editions).toHaveBeenCalledTimes(1))
  })

  it('"Accepted" cannot be chosen without verified evidence, and a hold needs no verification', async () => {
    api.submitEvidence.mockResolvedValue(submitted(unverified()))
    await open()
    await fillAndVerify()
    expect(screen.getByText('Could not be verified')).toBeTruthy()
    expect(screen.getByDisplayValue('accepted').disabled).toBe(true)
    expect(screen.getByDisplayValue('held').checked).toBe(true)
    fireEvent.change(screen.getByLabelText(/Why \(kept in the audit trail\)/), { target: { value: 'Waiting for the official notice text.' } })
    fireEvent.click(screen.getByLabelText('I confirm: On hold for Form I-131, edition 2025-01-20'))
    expect(screen.getByRole('button', { name: 'Record decision' }).disabled).toBe(false)
  })

  it('changing the decision clears the confirmation so it always names the chosen decision', async () => {
    await open()
    await fillAndVerify()
    fireEvent.click(screen.getByLabelText('I confirm: Accepted for filing for Form I-131, edition 2025-01-20'))
    fireEvent.click(screen.getByDisplayValue('not_accepted'))
    expect(screen.getByLabelText('I confirm: Not accepted for Form I-131, edition 2025-01-20').checked).toBe(false)
  })

  it('shows the server\'s message when a submission or decision is refused (e.g. the four-eyes rule)', async () => {
    api.submitEvidence.mockRejectedValueOnce({ response: { data: { message: 'The verbatim quote must be at least 25 characters' } } })
    await open()
    fireEvent.click(screen.getAllByRole('button', { name: 'Add evidence' })[0])
    fireEvent.change(screen.getByPlaceholderText('https://www.uscis.gov/...'), { target: { value: 'https://www.uscis.gov/x' } })
    fireEvent.change(screen.getByPlaceholderText(/Paste the sentence/), { target: { value: 'short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch and verify' }))
    expect((await screen.findByRole('alert')).textContent).toBe('The verbatim quote must be at least 25 characters')

    api.recordDecision.mockRejectedValueOnce({ response: { data: { message: 'An accepted decision must be made by a different admin or team lead than the one who submitted the evidence' } } })
    fireEvent.click(screen.getByRole('button', { name: 'Fetch and verify' }))
    await screen.findByTestId('verification-results')
    fireEvent.change(screen.getByLabelText(/Why \(kept in the audit trail\)/), { target: { value: 'Verified against the official notice.' } })
    fireEvent.click(screen.getByLabelText('I confirm: Accepted for filing for Form I-131, edition 2025-01-20'))
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/different admin or team lead/)
    expect(screen.queryByTestId('decision-recorded')).toBeNull()
  })

  it('shows a load error without crashing', async () => {
    api.editions.mockReset().mockRejectedValue({ response: { data: { message: 'Not authorized' } } })
    render(<FormEditionEvidenceSection />)
    expect((await screen.findByRole('alert')).textContent).toBe('Not authorized')
  })
})
