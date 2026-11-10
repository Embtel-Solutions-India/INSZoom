import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import QuestionnaireAnswersPanel from './QuestionnaireAnswersPanel'

// The L1A Documentation Checklist keeps its uploads inside their own sections (questionnaire.settings.inlineDocuments). The staff view then shows each section in the checklist's own
// order - uploads and answers mixed, as numbered - and an item with parts (13, 14) shows its a / b / c / d lines. Every other checklist is unchanged (answers first, then uploads).
afterEach(cleanup)

const sections = [{ key: 'us', title: 'Documents from the U.S. Company', order: 1 }, { key: 'foreign', title: 'Documents from the Foreign (outside U.S.) Company', order: 2 }]
const duties = '13. Detailed Managerial Duties at foreign entity as per following sections and % of each:\n    a. Manages a corporation, department, subdivision, or function.\n    b. Supervises and controls the work of other supervisory, professional, or managerial employees, or else manages essential functions.\n    c. Has the authority to make personal decisions as to hiring and termination, or else function at a senior level, or\n    d. Exercises discretion over the day to day operations of the activity or function for which he or she has authority.'
const emails = '14. Copies of emails, memos, letters and other such dispatches from beneficiary (in a foreign country) that show:\n    a. Beneficiary supervising and controlling the work of the subordinate staff in the organizational chart.\n    b. Beneficiary hiring and firing and recommending personal actions.\n    c. Beneficiary issuing orders regarding day-to-day operations (of subordinate staff).\n    d. Performance reviews by beneficiary for the subordinate staff for one continuous year.'

const fieldQuestions = [
  { key: 'us_company_website', label: '6. Company Website', type: 'text', sectionKey: 'us', order: 2 },
  { key: 'duties', label: duties, type: 'textarea', sectionKey: 'foreign', order: 4 },
]
const documentQuestions = [
  { key: 'us_articles', label: '1. Articles of Incorporation', type: 'file', sectionKey: 'us', order: 1 },
  { key: 'foreign_minutes', label: '12. Extract from the Minutes', type: 'file', sectionKey: 'foreign', order: 3 },
  { key: 'foreign_emails', label: emails, type: 'file', sectionKey: 'foreign', order: 5 },
  { key: 'foreign_resumes', label: "15. Subordinate Employees' Resumes", type: 'file', sectionKey: 'foreign', order: 6 },
]

describe('QuestionnaireAnswersPanel - uploads inside their sections (settings.inlineDocuments)', () => {
  it('shows each section in the checklist order with question 13 and question 14 and their lettered parts', () => {
    render(<QuestionnaireAnswersPanel questionnaire={{ _id: 'q', title: 'L1A Documentation Checklist', sections, settings: { inlineDocuments: true } }} fieldQuestions={fieldQuestions} documentQuestions={documentQuestions} answerMap={{}} filesByKey={{}} />)
    const blocks = screen.getAllByTestId('inline-section')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].textContent.indexOf('1. Articles of Incorporation')).toBeGreaterThan(-1)
    expect(blocks[0].textContent.indexOf('1. Articles of Incorporation')).toBeLessThan(blocks[0].textContent.indexOf('6. Company Website'))
    const text = blocks[1].textContent
    const at = (needle) => text.indexOf(needle)
    expect(at('12. Extract')).toBeGreaterThan(-1)
    expect(at('12. Extract')).toBeLessThan(at('13. Detailed Managerial Duties'))
    expect(at('13. Detailed Managerial Duties')).toBeLessThan(at('14. Copies of emails'))
    expect(at('14. Copies of emails')).toBeLessThan(at('15. Subordinate'))
    // the four parts of 13 and of 14 are shown, a to d
    for (const part of ['a. Manages a corporation', 'b. Supervises and controls', 'c. Has the authority', 'd. Exercises discretion', 'a. Beneficiary supervising', 'b. Beneficiary hiring', 'c. Beneficiary issuing orders', 'd. Performance reviews']) {
      expect(text).toContain(part)
    }
  })

  it('every checklist is now shown the same way, with or without the setting: its own sections, in order, uploads inside them', () => {
    render(<QuestionnaireAnswersPanel questionnaire={{ _id: 'q', title: 'Other', sections }} fieldQuestions={fieldQuestions} documentQuestions={documentQuestions} answerMap={{}} filesByKey={{}} />)
    const blocks = screen.getAllByTestId('inline-section')
    expect(blocks).toHaveLength(2)
    expect(blocks[0].textContent.indexOf('1. Articles of Incorporation')).toBeLessThan(blocks[0].textContent.indexOf('6. Company Website'))
    expect(blocks[1].textContent.indexOf('12. Extract')).toBeLessThan(blocks[1].textContent.indexOf('13. Detailed Managerial Duties'))
  })
})
