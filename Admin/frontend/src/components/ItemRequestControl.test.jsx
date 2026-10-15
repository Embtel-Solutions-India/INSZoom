import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => { cleanup() })

// The case manager's per-item "Request" control: popup with the details, e-mail + required-for-this-case on send,
// re-send / withdraw for an item that is already requested, recipient choice when ambiguous. The API is faked.
const api = vi.hoisted(() => ({ requestItem: vi.fn(), cancelItemRequest: vi.fn() }))
vi.mock('../services/api', () => ({ informationRequestsApi: { requestItem: (...a) => api.requestItem(...a), cancelItemRequest: (...a) => api.cancelItemRequest(...a) } }))

import ItemRequestControl from './ItemRequestControl'
import QuestionnaireAnswersPanel from './QuestionnaireAnswersPanel'

const question = { key: 'passport_copy', label: 'Passport copy', type: 'file', sectionKey: 's' }
const baseRequests = (over = {}) => ({ caseId: 'case-1', targetRole: 'employee', referenceId: undefined, items: [], onChanged: vi.fn(async () => {}), ...over })

beforeEach(() => {
  api.requestItem.mockReset().mockResolvedValue({ data: { success: true, resent: false } })
  api.cancelItemRequest.mockReset().mockResolvedValue({ data: { success: true } })
})

describe('ItemRequestControl', () => {
  it('renders nothing when the panel has no request context (existing screens are unchanged)', () => {
    const { container } = render(<ItemRequestControl question={question} requests={undefined} />)
    expect(container.textContent).toBe('')
  })

  it('sends a request with the details the case manager typed, then refreshes the list', async () => {
    const requests = baseRequests()
    render(<ItemRequestControl question={question} requests={requests} />)
    fireEvent.click(screen.getByRole('button', { name: /Request: Passport copy/ }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText(/required for this case only/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/What do you need from the client/), { target: { value: 'Blurry scan - re-upload all pages' } })
    fireEvent.click(screen.getByText('Send request'))
    await waitFor(() => expect(api.requestItem).toHaveBeenCalledWith('case-1', expect.objectContaining({ questionKey: 'passport_copy', targetRole: 'employee', note: 'Blurry scan - re-upload all pages' })))
    await waitFor(() => expect(requests.onChanged).toHaveBeenCalled())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows Requested / Received chips from the server state, and offers Request again', () => {
    const { rerender } = render(<ItemRequestControl question={question} requests={baseRequests({ items: [{ requestId: 'r1', questionKey: 'passport_copy', status: 'open', note: 'x' }] })} />)
    expect(screen.getByText('Requested')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Request again: Passport copy/ })).toBeTruthy()
    rerender(<ItemRequestControl question={question} requests={baseRequests({ items: [{ requestId: 'r1', questionKey: 'passport_copy', status: 'submitted' }] })} />)
    expect(screen.getByText('Received')).toBeTruthy()
    // a withdrawn request shows no chip and is askable as new
    rerender(<ItemRequestControl question={question} requests={baseRequests({ items: [{ requestId: 'r1', questionKey: 'passport_copy', status: 'closed' }] })} />)
    expect(screen.queryByText('Requested')).toBeNull()
    expect(screen.getByRole('button', { name: /Request: Passport copy/ })).toBeTruthy()
  })

  it('withdraws an existing request', async () => {
    const requests = baseRequests({ items: [{ requestId: 'r1', questionKey: 'passport_copy', status: 'open', note: 'old' }] })
    render(<ItemRequestControl question={question} requests={requests} />)
    fireEvent.click(screen.getByRole('button', { name: /Request again/ }))
    fireEvent.click(screen.getByText('Withdraw request'))
    await waitFor(() => expect(api.cancelItemRequest).toHaveBeenCalledWith('case-1', 'r1'))
    await waitFor(() => expect(requests.onChanged).toHaveBeenCalled())
  })

  it('asks which person to send to when the server says it is ambiguous, then sends to the chosen one', async () => {
    api.requestItem.mockRejectedValueOnce({ response: { data: { code: 'RECIPIENT_REQUIRED', recipients: [{ id: 'p:1', label: 'Employee - Ana' }, { id: 'p:2', label: 'Employee - Bo' }] } } })
    render(<ItemRequestControl question={question} requests={baseRequests()} />)
    fireEvent.click(screen.getByRole('button', { name: /Request: Passport copy/ }))
    fireEvent.click(screen.getByText('Send request'))
    const select = await screen.findByLabelText('Send to')
    fireEvent.change(select, { target: { value: 'p:2' } })
    fireEvent.click(screen.getByText('Send request'))
    await waitFor(() => expect(api.requestItem).toHaveBeenLastCalledWith('case-1', expect.objectContaining({ recipientId: 'p:2' })))
  })

  it('shows the server error and keeps the popup open when sending fails', async () => {
    api.requestItem.mockRejectedValueOnce({ response: { data: { message: 'There is no client on this checklist to send the request to' } } })
    render(<ItemRequestControl question={question} requests={baseRequests()} />)
    fireEvent.click(screen.getByRole('button', { name: /Request: Passport copy/ }))
    fireEvent.click(screen.getByText('Send request'))
    expect((await screen.findByRole('alert')).textContent).toContain('no client on this checklist')
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('QuestionnaireAnswersPanel with the Request control', () => {
  const questionnaire = { _id: 'q1', title: 'Employee Checklist', sections: [{ key: 's', title: 'Section' }] }
  const props = {
    questionnaire,
    fieldQuestions: [{ key: 'first_name', label: 'First name', type: 'text', sectionKey: 's' }],
    documentQuestions: [question],
    answerMap: { first_name: 'Ana' },
    filesByKey: {},
  }

  it('adds a Request button to every text answer and every document - answered or not', () => {
    render(<QuestionnaireAnswersPanel {...props} requests={baseRequests()} />)
    expect(screen.getByRole('button', { name: /Request: First name/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Request: Passport copy/ })).toBeTruthy()
  })

  it('lays each answer out like the edit form: question left, Request right on the same row, answer (or "Needed") in a box below', () => {
    const { container } = render(<QuestionnaireAnswersPanel {...props} fieldQuestions={[...props.fieldQuestions, { key: 'middle', label: 'Middle Name', type: 'text', sectionKey: 's' }]} requests={baseRequests()} />)
    const grid = container.querySelector('[class~="md:grid-cols-2"]')
    expect(grid).toBeTruthy() // two columns
    const requestButton = screen.getByRole('button', { name: /Request: Middle Name/ })
    const header = requestButton.closest('div.justify-between')
    expect(header.textContent).toContain('Middle Name') // the question and its Request button share one row
    expect(header.firstElementChild.textContent).toBe('Middle Name') // question on the left, control on the right
    const box = header.nextElementSibling
    expect(box.textContent).toBe('Needed')
    expect(box.getAttribute('data-answered')).toBe('false')
    // an answered one shows its value in the box
    const answeredHeader = screen.getByRole('button', { name: /Request: First name/ }).closest('div.justify-between')
    expect(answeredHeader.nextElementSibling.textContent).toBe('Ana')
    expect(answeredHeader.nextElementSibling.getAttribute('data-answered')).toBe('true')
  })

  it('short questions pair up two to a row and come together; long ones take a full row each and come together after them', () => {
    const questions = [
      { key: 'q_short_1', label: 'Last Name', type: 'text', sectionKey: 's' },
      { key: 'q_long_label', label: 'Do you or any other person in this petition have a valid passport (Yes/No)?', type: 'text', sectionKey: 's' },
      { key: 'q_short_2', label: 'First Name', type: 'text', sectionKey: 's' },
      { key: 'q_area', label: 'Current U.S. address', type: 'textarea', sectionKey: 's' },
      { key: 'q_long_value', label: 'Job location', type: 'text', sectionKey: 's' },
      { key: 'q_short_3', label: 'Country of birth', type: 'text', sectionKey: 's' },
    ]
    const answerMap = { q_short_1: 'Oberoi', q_short_2: 'Ishaan', q_short_3: 'India', q_long_value: '1600 Amphitheatre Parkway, Mountain View, California 94043, United States' }
    render(<QuestionnaireAnswersPanel questionnaire={questionnaire} fieldQuestions={questions} documentQuestions={[]} answerMap={answerMap} filesByKey={{}} requests={baseRequests()} />)
    const shortGroup = screen.getByTestId('short-questions')
    const longGroup = screen.getByTestId('long-questions')
    expect(shortGroup.className).toContain('md:grid-cols-2') // two to a row
    expect(shortGroup.textContent).toContain('Last Name')
    expect(shortGroup.textContent).toContain('First Name')
    expect(shortGroup.textContent).toContain('Country of birth')
    expect(shortGroup.textContent).not.toContain('Current U.S. address')
    expect(longGroup.className).not.toContain('md:grid-cols-2') // one per row
    ;['valid passport', 'Current U.S. address', 'Job location'].forEach((label) => expect(longGroup.textContent).toContain(label))
    // the short group comes first, the long group after it
    expect(shortGroup.compareDocumentPosition(longGroup) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // order inside each group is the checklist's own order
    expect(longGroup.textContent.indexOf('valid passport')).toBeLessThan(longGroup.textContent.indexOf('Current U.S. address'))
  })

  it('is unchanged without the request context', () => {
    render(<QuestionnaireAnswersPanel {...props} />)
    expect(screen.queryByRole('button', { name: /Request/ })).toBeNull()
    expect(screen.getByText('Ana')).toBeTruthy()
  })
})
