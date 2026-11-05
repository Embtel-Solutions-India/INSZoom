import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import QuestionnaireAnswersPanel from './QuestionnaireAnswersPanel'

// One login, many cases (Phase 3A): staff see which answers were copied from the person's earlier case.
afterEach(cleanup)
const questionnaire = { _id: 'q1', title: 'Applicant Checklist', sections: [{ key: 's', title: 'Section' }] }
const fieldQuestions = [{ key: 'first_name', label: 'First name', type: 'text', sectionKey: 's' }, { key: 'last_name', label: 'Last name', type: 'text', sectionKey: 's' }]

describe('QuestionnaireAnswersPanel - pre-filled from an earlier case', () => {
  it('marks a copied answer with its source case; other answers carry no marker', () => {
    const answerMap = { first_name: 'Ana', last_name: 'Silva' }
    Object.defineProperty(answerMap, '__prefilledFromEarlierCase', { value: { first_name: { sourceVisaType: 'H-1B', sourceCaseNumber: 'B471' } }, enumerable: false })
    render(<QuestionnaireAnswersPanel questionnaire={questionnaire} fieldQuestions={fieldQuestions} documentQuestions={[]} answerMap={answerMap} filesByKey={{}} />)
    const markers = screen.getAllByTestId('prefilled-from')
    expect(markers).toHaveLength(1)
    expect(markers[0].textContent).toBe('Pre-filled from earlier case (H-1B · B471)')
  })

  it('a plain answer map (every existing screen) shows no marker', () => {
    render(<QuestionnaireAnswersPanel questionnaire={questionnaire} fieldQuestions={fieldQuestions} documentQuestions={[]} answerMap={{ first_name: 'Ana' }} filesByKey={{}} />)
    expect(screen.queryByTestId('prefilled-from')).toBeNull()
  })

  it('marks a document copied from the earlier case (3B)', () => {
    const answerMap = {}
    Object.defineProperty(answerMap, '__prefilledFromEarlierCase', { value: { passport: { sourceVisaType: 'H-1B', sourceCaseNumber: 'B471', document: 'passport' } }, enumerable: false })
    const documentQuestions = [{ key: 'passport', label: 'Copy of passport', type: 'file', sectionKey: 's' }]
    render(<QuestionnaireAnswersPanel questionnaire={questionnaire} fieldQuestions={[]} documentQuestions={documentQuestions} answerMap={answerMap} filesByKey={{ passport: [{ originalName: 'passport.pdf', storageKey: 'k' }] }} />)
    expect(screen.getByTestId('prefilled-from').textContent).toBe('Copied from earlier case (H-1B · B471)')
  })
})

