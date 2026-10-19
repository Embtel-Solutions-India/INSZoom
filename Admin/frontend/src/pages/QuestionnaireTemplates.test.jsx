import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

afterEach(() => { cleanup() })

// Questionnaire page: retired questions are not listed, a type change sends only the type (not the whole question back), Done saves and closes, and Delete
// retires the question and removes its card. The API is faked.
const api = vi.hoisted(() => ({
  list: vi.fn(), get: vi.fn(), updateQuestion: vi.fn(), deleteQuestion: vi.fn(), createQuestion: vi.fn(), reorder: vi.fn(),
}))
vi.mock('../services/api', () => ({
  questionnairesApi: {
    list: (...a) => api.list(...a), get: (...a) => api.get(...a), updateQuestion: (...a) => api.updateQuestion(...a), deleteQuestion: (...a) => api.deleteQuestion(...a),
    createQuestion: (...a) => api.createQuestion(...a), reorder: (...a) => api.reorder(...a), visaOptions: vi.fn().mockResolvedValue({ data: { data: [] } }),
    update: vi.fn().mockResolvedValue({ data: { data: {} } }), mappings: vi.fn().mockResolvedValue({ data: { data: [] } }),
  },
  eligibilityQuizApi: { visas: vi.fn().mockResolvedValue({ data: { data: [] } }) },
}))
vi.mock('../components/ChecklistUsageCard', () => ({ default: () => null }))

import QuestionnaireTemplates from './QuestionnaireTemplates'

const template = { _id: 't1', key: 'x_checklist', title: 'X Checklist', version: 1, status: 'draft', visaType: 'H1B', visaTypes: ['H1B'], checklistRole: 'client', sections: [{ key: 'part_1', title: 'Part 1', order: 1 }] }
const question = (over = {}) => ({ _id: 'q1', key: 'first_name', label: 'First name', type: 'text', sectionKey: 'part_1', pageKey: 'part_1', order: 1, required: false, active: true, options: [], metadata: {}, ...over })

beforeEach(() => {
  api.list.mockReset().mockResolvedValue({ data: { data: [template] } })
  api.get.mockReset().mockResolvedValue({ data: { data: { questionnaire: template, questions: [
    question(),
    question({ _id: 'q2', key: 'old_question', label: 'Old retired question', active: false, isActive: false }),
    question({ _id: 'q3', key: 'state', label: 'State', type: 'select', order: 2, options: [{ label: 'Alabama', value: 'AL' }, { label: 'Alaska', value: 'AK' }] }),
  ] } } })
  api.updateQuestion.mockReset().mockImplementation((_t, id, patch) => Promise.resolve({ data: { data: { ...question({ _id: id }), ...patch } } }))
  api.deleteQuestion.mockReset().mockResolvedValue({ data: { success: true } })
})

const open = async () => {
  render(<QuestionnaireTemplates />)
  await screen.findByText('First name')
}

describe('Questionnaire builder', () => {
  it('does not list a retired (deleted) question', async () => {
    await open()
    expect(screen.queryByText('Old retired question')).toBeNull()
    expect(screen.getByText('State')).toBeTruthy()
  })

  it('a type change sends only the type, and Done saves and closes the editor', async () => {
    await open()
    fireEvent.click(screen.getByText('First name'))
    const select = await screen.findByDisplayValue('Short answer')
    fireEvent.change(select, { target: { value: 'textarea' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(api.updateQuestion).toHaveBeenCalledTimes(1))
    expect(api.updateQuestion).toHaveBeenCalledWith('t1', 'q1', { type: 'textarea' })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Done' })).toBeNull())
    expect(screen.getByText('Long answer')).toBeTruthy()
  })

  it('opening and closing a question without changing anything saves nothing, and option values are never rewritten', async () => {
    await open()
    fireEvent.click(screen.getByText('State'))
    await screen.findByDisplayValue('Alabama')
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Done' })).toBeNull())
    expect(api.updateQuestion).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('State'))
    fireEvent.change(await screen.findByDisplayValue('Alabama'), { target: { value: 'Alabama (AL)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(api.updateQuestion).toHaveBeenCalledTimes(1))
    // the label changed, the stored value (AL) did not
    expect(api.updateQuestion.mock.calls[0][2]).toEqual({ options: [{ label: 'Alabama (AL)', value: 'AL' }, { label: 'Alaska', value: 'AK' }] })
  })

  it('Cancel discards the edit', async () => {
    await open()
    fireEvent.click(screen.getByText('First name'))
    fireEvent.change(await screen.findByDisplayValue('First name'), { target: { value: 'Given name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.updateQuestion).not.toHaveBeenCalled()
    expect(screen.getByText('First name')).toBeTruthy()
  })

  it('Delete asks first, retires the question and removes its card', async () => {
    await open()
    fireEvent.click(within(screen.getByText('First name').closest('.card')).getByTitle('Delete'))
    const dialog = await screen.findByRole('dialog')
    expect(api.deleteQuestion).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete question' }))
    await waitFor(() => expect(api.deleteQuestion).toHaveBeenCalledWith('t1', 'q1'))
    await waitFor(() => expect(screen.queryByText('First name')).toBeNull())
  })
})
