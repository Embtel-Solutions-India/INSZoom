import { describe, it, expect } from 'vitest'
import { staffReviewNotes } from './QuestionnaireAnswersPanel'

const question = { key: 'q1', metadata: { staffReview: [{ questionKey: 'q1', operator: 'equals', value: 'No', message: 'marriage not subsisting' }, { questionKey: 'q1', operator: 'in', value: ['X', 'Y'], message: 'x or y' }] } }

describe('staffReviewNotes', () => {
  it('lists the notes whose condition matches the saved answer', () => {
    expect(staffReviewNotes(question, { q1: 'No' })).toEqual(['marriage not subsisting'])
    expect(staffReviewNotes(question, { q1: 'Z' })).toEqual([])
    expect(staffReviewNotes(question, { q1: 'Y' })).toEqual(['x or y'])
    expect(staffReviewNotes(question, { q1: 'X' })).toEqual(['x or y'])
  })
  it('says nothing for an unanswered question or a question with no review rules', () => {
    expect(staffReviewNotes(question, {})).toEqual([])
    expect(staffReviewNotes({ key: 'z' }, { z: 'No' })).toEqual([])
    expect(staffReviewNotes(null, {})).toEqual([])
  })
})
