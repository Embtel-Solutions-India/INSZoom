import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Removing a question / changing its wording shows at once and is handed to the server as a background job; the screen never waits for the server.
// The API is faked.
const api = vi.hoisted(() => ({ getForCase: vi.fn(), editCaseChecklist: vi.fn(), invalidateCachedGet: vi.fn() }))
vi.mock('../services/api', () => ({
  questionnairesApi: { getForCase: (...a) => api.getForCase(...a), editCaseChecklist: (...a) => api.editCaseChecklist(...a) },
  invalidateCachedGet: (...a) => api.invalidateCachedGet(...a),
}))

import ChecklistEditorModal from './ChecklistEditorModal'

const checklist = { checklistId: 'i140_petitioner_checklist|employer', targetRole: 'employer', title: 'Petitioner checklist', referenceId: undefined }
const question = (key, label, order) => ({ key, label, order, type: 'text', sectionKey: 's1', active: true })
const SERVER = () => ({ data: { data: { questions: serverQuestions, hiddenQuestions: [], questionnaire: { sections: [{ key: 's1', title: 'Company', order: 1 }] } } } })
let serverQuestions
let caseCounter = 0
const open = (props = {}) => render(<ChecklistEditorModal caseId={`case-${caseCounter}`} checklist={checklist} onClose={() => {}} onSaved={vi.fn()} {...props} />)
const shown = (label) => screen.queryByDisplayValue(label)

beforeEach(() => {
  caseCounter += 1 // a fresh case id per test: the pending-change memory is per case + checklist
  serverQuestions = [question('q1', 'Company name', 1), question('q2', 'Business type', 2), question('q3', 'Gross income', 3)]
  api.getForCase.mockReset().mockImplementation(async () => SERVER())
  api.editCaseChecklist.mockReset().mockResolvedValue({ status: 202, data: { success: true, queued: true } })
  api.invalidateCachedGet.mockReset()
})
afterEach(() => { cleanup(); vi.useRealTimers() })

const removeButtonOf = (label) => within(label).getByRole('button', { name: /Remove/ })
const rowOf = (label) => shown(label).closest('li')
import { within } from '@testing-library/react'

describe('ChecklistEditorModal - instant edits', () => {
  it('removes the question from the screen immediately, without waiting for the server', async () => {
    let release
    api.editCaseChecklist.mockImplementation(() => new Promise((resolve) => { release = resolve })) // the server is slow
    open()
    await screen.findByDisplayValue('Business type')
    fireEvent.click(removeButtonOf(rowOf('Business type')))
    expect(shown('Business type')).toBeNull() // gone this instant
    expect(shown('Company name')).toBeTruthy()
    expect(shown('Gross income')).toBeTruthy()
    expect(screen.queryByText(/Saving/)).toBeNull()
    await waitFor(() => expect(api.editCaseChecklist).toHaveBeenCalledTimes(1))
    expect(api.editCaseChecklist).toHaveBeenCalledWith(`case-${caseCounter}`, { checklistId: checklist.checklistId, op: 'remove', questionKey: 'q2', background: true })
    release({ status: 202, data: {} })
  })

  it('keeps the question hidden if the editor reloads before the server has finished, and lets go once the server agrees', async () => {
    const first = open()
    await screen.findByDisplayValue('Business type')
    fireEvent.click(removeButtonOf(rowOf('Business type')))
    await waitFor(() => expect(api.editCaseChecklist).toHaveBeenCalled())
    first.unmount()

    open() // re-opened while the server still lists the question (the job has not run yet)
    await screen.findByDisplayValue('Company name')
    expect(shown('Business type')).toBeNull()

    serverQuestions = serverQuestions.filter((item) => item.key !== 'q2') // the server has now carried it out
    first.unmount?.()
    cleanup()
    open()
    await screen.findByDisplayValue('Company name')
    expect(shown('Business type')).toBeNull()
    serverQuestions = [...serverQuestions, question('q2', 'Business type', 2)] // later re-added: no stale memory hides it
    cleanup()
    open()
    expect(await screen.findByDisplayValue('Business type')).toBeTruthy()
  })

  it('shows a changed wording at once and sends it as a background update', async () => {
    api.editCaseChecklist.mockImplementation(() => new Promise(() => {})) // never answers
    open()
    const box = await screen.findByDisplayValue('Company name')
    fireEvent.change(box, { target: { value: 'Legal company name' } })
    const save = within(box.closest('li')).getByRole('button', { name: 'Save' })
    fireEvent.click(save)
    expect(shown('Legal company name')).toBeTruthy()
    expect(shown('Company name')).toBeNull()
    expect(screen.queryByText(/Saving/)).toBeNull()
    await waitFor(() => expect(api.editCaseChecklist).toHaveBeenCalledWith(`case-${caseCounter}`, expect.objectContaining({ op: 'update', questionKey: 'q1', patch: { label: 'Legal company name' }, background: true })))
  })

  it('puts the question back, with the reason, when the server refuses the change for good', async () => {
    api.editCaseChecklist.mockRejectedValue({ response: { status: 403, data: { message: 'Not authorized to manage this case\'s checklists' } } })
    open()
    await screen.findByDisplayValue('Business type')
    fireEvent.click(removeButtonOf(rowOf('Business type')))
    expect(shown('Business type')).toBeNull() // optimistic first
    expect((await screen.findByRole('alert')).textContent).toMatch(/Not authorized/)
    expect(await screen.findByDisplayValue('Business type')).toBeTruthy() // restored
    expect(api.editCaseChecklist).toHaveBeenCalledTimes(1) // a refusal is not retried
  })

  it('retries only when the connection itself fails, and the question stays gone meanwhile', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.editCaseChecklist.mockRejectedValueOnce(new Error('Network Error')).mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue({ status: 202, data: {} })
    open()
    await screen.findByDisplayValue('Business type')
    fireEvent.click(removeButtonOf(rowOf('Business type')))
    expect(shown('Business type')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(8000) })
    expect(api.editCaseChecklist).toHaveBeenCalledTimes(3)
    expect(shown('Business type')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('removes several questions quickly, each request in order, none lost', async () => {
    open()
    await screen.findByDisplayValue('Company name')
    fireEvent.click(removeButtonOf(rowOf('Company name')))
    fireEvent.click(removeButtonOf(rowOf('Gross income')))
    expect(shown('Company name')).toBeNull()
    expect(shown('Gross income')).toBeNull()
    expect(shown('Business type')).toBeTruthy()
    await waitFor(() => expect(api.editCaseChecklist).toHaveBeenCalledTimes(2))
    expect(api.editCaseChecklist.mock.calls.map((call) => call[1].questionKey)).toEqual(['q1', 'q3'])
  })

  it('adding a question is unchanged: it waits for the server (the new key comes back) and is not sent as a background job', async () => {
    open()
    await screen.findByDisplayValue('Company name')
    fireEvent.change(screen.getByLabelText('New question text'), { target: { value: 'Tax id' } })
    fireEvent.click(screen.getByRole('button', { name: /Add question/ }))
    await waitFor(() => expect(api.editCaseChecklist).toHaveBeenCalledTimes(1))
    const body = api.editCaseChecklist.mock.calls[0][1]
    expect(body.op).toBe('add')
    expect(body.background).toBeUndefined()
  })
})
