import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'

// A case manager editing a BLANK checklist: the save must carry the response the server resolved for it (the answer list is empty, so the id cannot come from an answer).
const getForCase = vi.fn()
const saveAnswer = vi.fn()
vi.mock('../services/api', () => ({
  questionnairesApi: { getForCase: (...args) => getForCase(...args), saveAnswer: (...args) => saveAnswer(...args), saveFileAnswer: vi.fn(), removeAnswerFile: vi.fn() },
  documentIntelligenceApi: { autofillFromDocument: vi.fn() },
  invalidateCachedGet: vi.fn(),
}))

import useCaseQuestionnaire from './useCaseQuestionnaire'

const payload = (answers) => ({ data: { data: { questionnaire: { _id: 'q1' }, fieldQuestions: [{ key: 'level' }], documentQuestions: [], answers, responseId: 'resp-9', requestedItems: [] } } })

describe('useCaseQuestionnaire saveAnswer', () => {
  beforeEach(() => { getForCase.mockReset(); saveAnswer.mockReset(); saveAnswer.mockResolvedValue({}) })

  it('sends the server-resolved responseId when the checklist has no answers yet', async () => {
    getForCase.mockResolvedValue(payload([]))
    const { result } = renderHook(() => useCaseQuestionnaire('case1', 'employee'))
    await waitFor(() => expect(result.current.questionnaire).toBeTruthy())
    await act(async () => { await result.current.saveAnswer('level', "Master's") })
    expect(saveAnswer).toHaveBeenCalledTimes(1)
    expect(saveAnswer.mock.calls[0][1].responseId).toBe('resp-9')
  })

  it('still uses the answers response id when the server did not send one', async () => {
    getForCase.mockResolvedValue({ data: { data: { questionnaire: { _id: 'q1' }, fieldQuestions: [], documentQuestions: [], answers: [{ questionKey: 'a', value: 'x', responseId: 'resp-old' }], requestedItems: [] } } })
    const { result } = renderHook(() => useCaseQuestionnaire('case1', 'employee'))
    await waitFor(() => expect(result.current.questionnaire).toBeTruthy())
    await act(async () => { await result.current.saveAnswer('a', 'y') })
    expect(saveAnswer.mock.calls[0][1].responseId).toBe('resp-old')
  })
})
