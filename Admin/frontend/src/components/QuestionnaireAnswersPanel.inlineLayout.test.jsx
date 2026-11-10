import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import QuestionnaireAnswersPanel from './QuestionnaireAnswersPanel'

// The L1A Documentation Checklist (settings.inlineDocuments) is laid out in TWO columns like every other checklist: normal questions sit two to a row, and only a long one
// (a long answer, or a question with its a / b / c / d parts on separate lines) takes the full row.
afterEach(cleanup)

const sections = [{ key: 'foreign', title: 'Documents from the Foreign (outside U.S.) Company', order: 1 }]
const duties = '13. Detailed Managerial Duties at foreign entity as per following sections and % of each:\n    a. Manages a corporation.\n    b. Supervises and controls the work.\n    c. Has the authority to make decisions.\n    d. Exercises discretion.'
const emails = '14. Copies of emails, memos, letters and other such dispatches from beneficiary that show:\n    a. Supervising.\n    b. Hiring and firing.\n    c. Issuing orders.\n    d. Performance reviews.'

const fieldQuestions = [
  { key: 'website', label: '4. Company Website', type: 'text', sectionKey: 'foreign', order: 4 },
  { key: 'duties', label: duties, type: 'textarea', sectionKey: 'foreign', order: 13 },
]
const documentQuestions = [
  { key: 'lease', label: '2. Lease', type: 'file', sectionKey: 'foreign', order: 2 },
  { key: 'brochure', label: '5. Brochure', type: 'file', sectionKey: 'foreign', order: 5 },
  { key: 'emails', label: emails, type: 'file', sectionKey: 'foreign', order: 14 },
]

describe('QuestionnaireAnswersPanel - inline checklist layout', () => {
  it('uses a two-column grid; only the long questions (13 and 14) span both columns', () => {
    render(<QuestionnaireAnswersPanel questionnaire={{ _id: 'q', title: 'L1A Documentation Checklist', sections, settings: { inlineDocuments: true } }} fieldQuestions={fieldQuestions} documentQuestions={documentQuestions} answerMap={{}} filesByKey={{}} />)
    const section = screen.getByTestId('inline-section')
    const grid = section.querySelector('.grid')
    expect(grid.className).toMatch(/md:grid-cols-2/)
    const wide = within(section).getAllByTestId('wide-question')
    expect(wide).toHaveLength(2)
    expect(wide[0].className).toMatch(/md:col-span-2/)
    expect(wide[0].textContent).toContain('13. Detailed Managerial Duties')
    expect(wide[0].textContent).toContain('d. Exercises discretion')
    expect(wide[1].textContent).toContain('14. Copies of emails')
    expect(wide[1].textContent).toContain('d. Performance reviews')
    // the ordinary questions are NOT wide: they pair up
    const items = Array.from(grid.children)
    expect(items).toHaveLength(5)
    expect(items.filter((item) => /md:col-span-2/.test(item.className))).toHaveLength(2)
  })
})
