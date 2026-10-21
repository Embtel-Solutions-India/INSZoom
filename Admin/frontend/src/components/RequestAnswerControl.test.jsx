import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => { cleanup() })

// The case manager filling an information request on the client's behalf (text answer or document). The API is faked.
const api = vi.hoisted(() => ({ saveAnswer: vi.fn(), saveFileAnswer: vi.fn(), invalidateCachedGet: vi.fn() }))
vi.mock('../services/api', () => ({
  questionnairesApi: { saveAnswer: (...a) => api.saveAnswer(...a), saveFileAnswer: (...a) => api.saveFileAnswer(...a) },
  invalidateCachedGet: (...a) => api.invalidateCachedGet(...a),
}))

import RequestAnswerControl from './RequestAnswerControl'

const request = (over = {}) => ({
  _id: 'r1', title: 'Previous immigration records', itemKind: 'text', status: 'open', recipientRole: 'employee',
  questionnaireId: 'qn1', questionKey: 'req_1', referenceId: 'ref1', responseId: 'resp1', answer: null, options: [], ...over,
})
const LABEL = 'Answer for Previous immigration records'

let announced
const listener = (event) => announced.push(event.detail)
beforeEach(() => {
  announced = []
  window.addEventListener('case-answers-changed', listener)
  api.saveAnswer.mockReset().mockResolvedValue({ data: { success: true } })
  api.saveFileAnswer.mockReset().mockResolvedValue({ data: { success: true } })
  api.invalidateCachedGet.mockReset()
})
afterEach(() => window.removeEventListener('case-answers-changed', listener))

describe('RequestAnswerControl', () => {
  it("saves a typed answer into the request's own response, then announces the change so every section re-reads", async () => {
    const onSaved = vi.fn(async () => {})
    render(<RequestAnswerControl request={request()} caseId="case-1" onSaved={onSaved} />)
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: '  Approved I-485 in 2019  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.saveAnswer).toHaveBeenCalledTimes(1))
    expect(api.saveAnswer).toHaveBeenCalledWith('qn1', {
      caseId: 'case-1', targetRole: 'employee', referenceId: 'ref1', responseId: 'resp1',
      answers: [{ questionKey: 'req_1', value: 'Approved I-485 in 2019' }],
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(api.invalidateCachedGet).toHaveBeenCalledWith('/questionnaires/case/case-1')
    expect(announced).toEqual([{ caseId: 'case-1' }])
    expect(await screen.findByText('Saved for the client.')).toBeTruthy()
  })

  it('uploads one or several files for a document request, with the request response and question', async () => {
    const onSaved = vi.fn(async () => {})
    render(<RequestAnswerControl request={request({ itemKind: 'document' })} caseId="case-1" onSaved={onSaved} />)
    const input = screen.getByLabelText('Upload for Previous immigration records')
    const files = [new File(['a'], 'one.pdf', { type: 'application/pdf' }), new File(['b'], 'two.pdf', { type: 'application/pdf' })]
    fireEvent.change(input, { target: { files } })
    await waitFor(() => expect(api.saveFileAnswer).toHaveBeenCalledTimes(1))
    const [id, formData] = api.saveFileAnswer.mock.calls[0]
    expect(id).toBe('qn1')
    expect(formData.getAll('files').map((file) => file.name)).toEqual(['one.pdf', 'two.pdf'])
    expect(Object.fromEntries([...formData.entries()].filter(([key]) => key !== 'files'))).toEqual({
      caseId: 'case-1', targetRole: 'employee', referenceId: 'ref1', responseId: 'resp1', questionKey: 'req_1',
    })
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(announced).toEqual([{ caseId: 'case-1' }])
    expect(await screen.findByText('2 files uploaded for the client.')).toBeTruthy()
  })

  it('offers the right input for each kind of request (yes/no, choice list, date, number, long text)', () => {
    const kinds = [['yes_no', 'SELECT', ['Choose…', 'Yes', 'No']], ['select', 'SELECT', ['Choose…', 'A', 'B']], ['date', 'INPUT', 'date'], ['number', 'INPUT', 'number'], ['textarea', 'TEXTAREA', null]]
    for (const [itemKind, tag, expected] of kinds) {
      const { unmount } = render(<RequestAnswerControl request={request({ itemKind, options: ['A', 'B'] })} caseId="case-1" />)
      const field = screen.getByLabelText(LABEL)
      expect(field.tagName).toBe(tag)
      if (Array.isArray(expected)) expect([...field.options].map((option) => option.text)).toEqual(expected)
      else if (expected) expect(field.type).toBe(expected)
      unmount()
    }
  })

  it('a received request can be updated: the box starts with the stored answer and the button says Update', () => {
    render(<RequestAnswerControl request={request({ status: 'submitted', answer: { value: 'First answer' } })} caseId="case-1" />)
    expect(screen.getByLabelText(LABEL).value).toBe('First answer')
    expect(screen.getByRole('button', { name: 'Update' })).toBeTruthy()
  })

  it('shows nothing for a request it cannot fill (closed / rejected / approved / legacy without a question)', () => {
    for (const over of [{ status: 'closed' }, { status: 'rejected' }, { status: 'approved' }, { responseId: undefined }, { questionKey: undefined }, { questionnaireId: undefined }]) {
      const { container, unmount } = render(<RequestAnswerControl request={request(over)} caseId="case-1" />)
      expect(container.textContent).toBe('')
      unmount()
    }
  })

  it('an empty answer is refused locally; a server error is shown and nothing is announced', async () => {
    render(<RequestAnswerControl request={request()} caseId="case-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Enter the answer first.')).toBeTruthy()
    expect(api.saveAnswer).not.toHaveBeenCalled()

    api.saveAnswer.mockRejectedValueOnce({ response: { data: { message: 'Answer is not one of the allowed options' } } })
    fireEvent.change(screen.getByLabelText(LABEL), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Answer is not one of the allowed options')).toBeTruthy()
    expect(announced).toEqual([])
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false)) // can try again
  })

  it('a failed upload shows the error and does not announce a change', async () => {
    api.saveFileAnswer.mockRejectedValueOnce(new Error('File type not allowed'))
    render(<RequestAnswerControl request={request({ itemKind: 'document' })} caseId="case-1" />)
    fireEvent.change(screen.getByLabelText('Upload for Previous immigration records'), { target: { files: [new File(['a'], 'x.exe')] } })
    expect(await screen.findByText('File type not allowed')).toBeTruthy()
    expect(announced).toEqual([])
  })
})
