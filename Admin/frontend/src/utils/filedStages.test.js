import { describe, it, expect } from 'vitest'
import { FILED_STAGE_KEYS, isFiledByStage, shownTrackingStatus } from './filedStages'

describe('filed stages', () => {
  it('Submitted and every later stage count as filed; On Hold and the earlier stages do not', () => {
    for (const key of ['submitted_fedex', 'receipt_tracking', 'rfe', 'status_approved', 'status_disapproved', 'feedback']) expect(isFiledByStage(key)).toBe(true)
    for (const key of ['on_hold', 'case_onboarded', 'docs_checklist', 'docs_received', 'draft_ready', 'internal_review', 'client_review', '', undefined, null]) expect(isFiledByStage(key)).toBe(false)
    expect(FILED_STAGE_KEYS).toHaveLength(6)
  })

  it('a pre-filing status reads as Filed at a filed stage; everything else is shown as recorded', () => {
    expect(shownTrackingStatus('draft', 'submitted_fedex')).toBe('filed')
    expect(shownTrackingStatus('ready_to_file', 'rfe')).toBe('filed')
    expect(shownTrackingStatus('', 'feedback')).toBe('filed')
    expect(shownTrackingStatus(undefined, 'status_approved')).toBe('filed')
    // later statuses are never overwritten by the stage
    expect(shownTrackingStatus('receipt_issued', 'submitted_fedex')).toBe('receipt_issued')
    expect(shownTrackingStatus('approved', 'status_approved')).toBe('approved')
    // not at a filed stage (including On Hold): exactly as recorded
    expect(shownTrackingStatus('draft', 'on_hold')).toBe('draft')
    expect(shownTrackingStatus('draft', 'internal_review')).toBe('draft')
    expect(shownTrackingStatus('draft', undefined)).toBe('draft')
    expect(shownTrackingStatus(undefined, undefined)).toBe('draft')
  })
})
