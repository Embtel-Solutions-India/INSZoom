import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => { cleanup() })

// The golden set review screen: staff can look, only the named reviewer (as the API reports) can answer and sign off, wording is plain, a "Wrong" answer needs a
// correction, and sign-off is only offered when nothing blocks it. The API is faked.
const api = vi.hoisted(() => ({ summary: vi.fn(), entries: vi.fn(), review: vi.fn(), signOff: vi.fn(), exportCsv: vi.fn() }))
vi.mock('../services/api', () => ({ goldenSetApi: { summary: (...a) => api.summary(...a), entries: (...a) => api.entries(...a), review: (...a) => api.review(...a), signOff: (...a) => api.signOff(...a), exportCsv: (...a) => api.exportCsv(...a) } }))

let mockUser = { role: 'admin' }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

import GoldenSetReviewSection, { READ_ROLES } from './GoldenSetReviewSection'

const entry = (over = {}) => ({ id: 'e1', ref: 'I-130 #1', formCode: 'I-130', formName: 'Petition for Alien Relative', familyLabel: 'Family-based', heldOut: false, where: 'Part 2, Item 14, page 2', boxLabel: 'Family Name (Last Name)', boxKind: 'text', belongsTo: 'Sponsor (petitioner)', fillsWith: "the sponsor's last (family) name", writtenAs: '', onlyWhen: '', ifEmpty: '', appearsTimes: 1, example: { clientData: 'Carter', boxShows: 'Carter' }, sentence: 's', review: null, ...over })
const summary = (over = {}) => ({ title: 't', note: 'n', total: 10, answered: 4, counts: { right: 3, wrong: 1, unsure: 0, unanswered: 6 }, perForm: [{ formCode: 'I-130', formName: 'Petition', total: 10, answered: 4 }], blockers: ['6 box(es) have no answer yet'], canSignOff: false, reviewers: ['admin@immiglance.com'], you: { email: 'admin@immiglance.com', canReview: true }, signOff: null, ...over })

beforeEach(() => {
  mockUser = { role: 'admin' }
  api.summary.mockReset().mockResolvedValue({ data: { data: summary() } })
  api.entries.mockReset().mockResolvedValue({ data: { data: { total: 1, offset: 0, limit: 20, entries: [entry()] } } })
  api.review.mockReset().mockResolvedValue({ data: { data: {} } })
  api.signOff.mockReset().mockResolvedValue({ data: { data: {} } })
})

describe('GoldenSetReviewSection', () => {
  it('shows nothing, and calls nothing, for roles that cannot read it', async () => {
    expect(READ_ROLES).toEqual(['super_admin', 'admin', 'team_lead'])
    mockUser = { role: 'client' }
    const { container } = render(<GoldenSetReviewSection />)
    expect(container.textContent).toBe('')
    expect(api.summary).not.toHaveBeenCalled()
  })

  it('shows plain wording only: where the box is, who it is about, what it is filled with and an example', async () => {
    render(<GoldenSetReviewSection />)
    await screen.findByText(/Family Name \(Last Name\)/)
    expect(screen.getByText("the sponsor's last (family) name")).toBeTruthy()
    expect(screen.getByText('Sponsor (petitioner)')).toBeTruthy()
    expect(screen.getByText(/Part 2, Item 14, page 2/)).toBeTruthy()
    expect(screen.getByText(/Answered/)).toBeTruthy()
    expect(document.body.textContent).not.toMatch(/petitioner\.|beneficiary\.|targetFieldId|form1\[/)
  })

  it('asks for the unanswered boxes first and "Right" saves straight away', async () => {
    render(<GoldenSetReviewSection />)
    await screen.findByText(/Family Name/)
    expect(api.entries).toHaveBeenCalledWith(expect.objectContaining({ status: 'unanswered' }))
    fireEvent.click(screen.getByRole('button', { name: 'Right' }))
    await waitFor(() => expect(api.review).toHaveBeenCalledWith('e1', { verdict: 'right', correction: '', note: '' }))
  })

  it('"Wrong" needs a correction before it can be saved', async () => {
    render(<GoldenSetReviewSection />)
    await screen.findByText(/Family Name/)
    fireEvent.click(screen.getByRole('button', { name: 'Wrong' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save "Wrong"' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/what this box should be filled with/)
    expect(api.review).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText(/What should this box be filled with instead/), { target: { value: "the employer's last name" } })
    fireEvent.click(screen.getByRole('button', { name: 'Save "Wrong"' }))
    await waitFor(() => expect(api.review).toHaveBeenCalledWith('e1', { verdict: 'wrong', correction: "the employer's last name", note: '' }))
  })

  it('someone who is not the reviewer can look but gets no answer buttons and no sign-off', async () => {
    api.summary.mockResolvedValue({ data: { data: summary({ you: { email: 'staff@immiglance.com', canReview: false } }) } })
    render(<GoldenSetReviewSection />)
    await screen.findByText(/Family Name/)
    expect(screen.getByTestId('not-reviewer').textContent).toMatch(/admin@immiglance\.com/)
    expect(screen.queryByRole('button', { name: 'Right' })).toBeNull()
    expect(screen.queryByTestId('sign-off-panel')).toBeNull()
  })

  it('sign-off lists what blocks it, and is offered only after the confirmation box is ticked', async () => {
    render(<GoldenSetReviewSection />)
    await screen.findByTestId('sign-off-panel')
    expect(screen.getByText('6 box(es) have no answer yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sign off the golden set' })).toBeNull()
    cleanup()
    api.summary.mockResolvedValue({ data: { data: summary({ blockers: [], canSignOff: true, answered: 10, counts: { right: 10, wrong: 0, unsure: 0, unanswered: 0 } }) } })
    render(<GoldenSetReviewSection />)
    const button = await screen.findByRole('button', { name: 'Sign off the golden set' })
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(api.signOff).toHaveBeenCalled())
  })

  it('a sign-off that is out of date is called out', async () => {
    api.summary.mockResolvedValue({ data: { data: summary({ signOff: { signedAt: '2026-10-01T10:00:00Z', reviewerEmail: 'admin@immiglance.com', upToDate: false } }) } })
    render(<GoldenSetReviewSection />)
    expect((await screen.findByTestId('signed-off')).textContent).toMatch(/out of date/)
  })
})
