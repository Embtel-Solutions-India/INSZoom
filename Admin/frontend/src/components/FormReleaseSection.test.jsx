import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

afterEach(() => { cleanup() })

// The release-safety screen: role gates, the gate decision in plain words, the migration-plan preview with its frozen list, rollback (reason required, cases not moved back),
// the recovery check, and the admin-only pre-image panel. API faked.
const api = vi.hoisted(() => ({ catalog: vi.fn(), gate: vi.fn(), plan: vi.fn(), rollback: vi.fn(), reconcile: vi.fn(), snapshots: vi.fn(), restore: vi.fn() }))
vi.mock('../services/api', () => ({
  formGovernanceApi: { catalog: (...a) => api.catalog(...a) },
  formReleaseApi: {
    gate: (...a) => api.gate(...a), migrationPlan: (...a) => api.plan(...a), rollback: (...a) => api.rollback(...a),
    reconcile: (...a) => api.reconcile(...a), snapshots: (...a) => api.snapshots(...a), restore: (...a) => api.restore(...a),
  },
}))

let mockUser = { role: 'admin' }
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: mockUser }) }))

import FormReleaseSection, { READ_ROLES, CHANGE_ROLES, SNAPSHOT_ROLES, DECISION_TEXT } from './FormReleaseSection'
import { describeRestore } from './FormReleasePreImagePanel'

const forms = [
  { formCode: 'I-131', title: 'Application for Travel Document', templateId: 't131', templateVersion: '2025-01-20', templateStatus: 'active' },
  { formCode: 'I-765', title: 'Employment Authorization', templateId: 't765', templateVersion: '2024-04-01', templateStatus: 'active' },
  { formCode: 'I-9', title: 'No template', templateId: null },
]
const gate = (over = {}) => ({ decision: 'blocked', error: 'Certification failed: pdf_fillable', checks: [{ name: 'approved', outcome: 'pass', detail: '' }, { name: 'certification', outcome: 'blocked', detail: 'the stored PDF exposes 0 fillable fields' }], ...over })
const plan = (over = {}) => ({ considered: 5, wouldMigrate: 2, blocked: 1, inProgress: 0, archivedValues: 3, collisions: [], unresolved: [], protectedValuesAffected: { manualOverrides: 4, verified: 6 }, fieldDiff: [], frozen: { count: 1, report: [{ caseFormId: 'cf1', caseId: 'c1', caseNumber: 'IM-100', status: 'filed', isLocked: true, fromEdition: '2024-01-01', priority: true }] }, ...over })

beforeEach(() => {
  mockUser = { role: 'admin' }
  api.catalog.mockReset().mockResolvedValue({ data: { data: forms } })
  api.gate.mockReset().mockResolvedValue({ data: { data: gate() } })
  api.plan.mockReset().mockResolvedValue({ data: { data: plan() } })
  api.rollback.mockReset().mockResolvedValue({ data: { data: { formCode: 'I-131', restored: { id: 'told', version: '2024-01-01' }, replaced: { version: '2025-01-20' }, caseFormsToReconcile: [{ caseFormId: 'cf9', caseId: 'c9', status: 'in_progress' }] } } })
  api.reconcile.mockReset().mockResolvedValue({ data: { data: { promotions: [], migrations: { resumed: 0 } } } })
  api.snapshots.mockReset().mockResolvedValue({ data: { data: [] } })
  api.restore.mockReset()
})

describe('FormReleaseSection', () => {
  it('shows nothing, and calls nothing, to roles outside super_admin / admin / team_lead', () => {
    expect(READ_ROLES).toEqual(['super_admin', 'admin', 'team_lead'])
    expect(CHANGE_ROLES).toEqual(['super_admin', 'admin'])
    expect(SNAPSHOT_ROLES).toEqual(['admin'])
    for (const role of ['case_manager', 'attorney', 'client', undefined]) {
      mockUser = role ? { role } : null
      const { container, unmount } = render(<FormReleaseSection />)
      expect(container.textContent).toBe('')
      unmount()
    }
    expect(api.catalog).not.toHaveBeenCalled()
  })

  it('lists only forms that have an edition and loads the gate and the plan for the picked one', async () => {
    render(<FormReleaseSection />)
    await screen.findByText('I-131')
    expect(screen.queryByText('I-9')).toBeNull()
    fireEvent.click(screen.getByText('I-131'))
    await screen.findByTestId('release-gate')
    expect(api.gate).toHaveBeenCalledWith('t131')
    expect(api.plan).toHaveBeenCalledWith('I-131', 't131')
  })

  it('explains the gate decision and each check in plain words', async () => {
    render(<FormReleaseSection forms={forms} />)
    fireEvent.click(screen.getByText('I-131'))
    const panel = await screen.findByTestId('release-gate')
    expect(panel.textContent).toContain(DECISION_TEXT.blocked.label)
    expect(panel.textContent).toContain('Test fill and correctness checks passed')
    expect(panel.textContent).toContain('the stored PDF exposes 0 fillable fields')
    expect(panel.textContent).toContain('First thing in the way')
  })

  it('previews the case-form move and lists the frozen case forms; nothing is called that changes data', async () => {
    render(<FormReleaseSection forms={forms} />)
    fireEvent.click(screen.getByText('I-131'))
    const preview = await screen.findByTestId('migration-plan')
    expect(preview.textContent).toMatch(/nothing was changed/)
    expect(screen.getByTestId('frozen-list').textContent).toMatch(/IM-100/)
    expect(screen.getByTestId('frozen-list').textContent).toMatch(/Priority/)
    expect(api.rollback).not.toHaveBeenCalled()
    expect(api.reconcile).not.toHaveBeenCalled()
  })

  it('one failing request does not hide the other', async () => {
    api.plan.mockRejectedValue({ response: { data: { message: 'plan failed' } } })
    render(<FormReleaseSection forms={forms} />)
    fireEvent.click(screen.getByText('I-131'))
    await screen.findByTestId('release-gate')
    expect((await screen.findByRole('alert')).textContent).toBe('plan failed')
  })

  it('rollback needs a written reason, says cases are NOT moved back, then lists the case forms to reconcile', async () => {
    render(<FormReleaseSection forms={forms} />)
    fireEvent.click(screen.getByText('I-131'))
    await screen.findByTestId('release-gate')
    fireEvent.click(screen.getByText(/Roll I-131 back/))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toMatch(/NOT moved back/)
    fireEvent.click(screen.getByText('Yes, roll back'))
    expect(api.rollback).not.toHaveBeenCalled()
    expect(dialog.textContent).toMatch(/at least 10 characters/)
    fireEvent.change(screen.getByRole('textbox', { name: /Why\?/ }), { target: { value: 'Wrong edition went live' } })
    fireEvent.click(screen.getByText('Yes, roll back'))
    await screen.findByTestId('rollback-result')
    expect(api.rollback).toHaveBeenCalledWith('I-131', { reason: 'Wrong edition went live' })
    expect(screen.getByTestId('reconcile-list').textContent).toMatch(/cf9/)
  })

  it('a refused rollback shows the server reason and keeps the dialog open', async () => {
    api.rollback.mockRejectedValue({ response: { data: { message: 'No certified earlier edition' } } })
    render(<FormReleaseSection forms={forms} />)
    fireEvent.click(screen.getByText('I-131'))
    await screen.findByTestId('release-gate')
    fireEvent.click(screen.getByText(/Roll I-131 back/))
    fireEvent.change(screen.getByRole('textbox', { name: /Why\?/ }), { target: { value: 'Wrong edition went live' } })
    fireEvent.click(screen.getByText('Yes, roll back'))
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toMatch(/No certified earlier edition/))
  })

  it('team_lead can read but sees no rollback, no recovery button and no saved copies; admin sees them all', async () => {
    mockUser = { role: 'team_lead' }
    const { unmount } = render(<FormReleaseSection forms={forms} />)
    fireEvent.click(screen.getByText('I-131'))
    await screen.findByTestId('release-gate')
    expect(screen.queryByText(/Roll I-131 back/)).toBeNull()
    expect(screen.queryByText('Run recovery check')).toBeNull()
    expect(screen.queryByTestId('pre-image-panel')).toBeNull()
    unmount()
    mockUser = { role: 'super_admin' }
    const second = render(<FormReleaseSection forms={forms} />)
    expect(screen.getByText('Run recovery check')).toBeTruthy()
    expect(screen.queryByTestId('pre-image-panel')).toBeNull() // exactly admin
    second.unmount()
    mockUser = { role: 'admin' }
    render(<FormReleaseSection forms={forms} />)
    expect(screen.getByTestId('pre-image-panel')).toBeTruthy()
  })

  it('the recovery check reports what it did in words', async () => {
    api.reconcile.mockResolvedValue({ data: { data: { promotions: [{ formCode: 'I-131', outcome: 'rolled_forward' }], migrations: { resumed: 2, reconciliationRequired: 1 } } } })
    render(<FormReleaseSection forms={forms} />)
    fireEvent.click(screen.getByText('Run recovery check'))
    const status = await screen.findByText(/Recovery check done/)
    expect(status.textContent).toMatch(/I-131: rolled forward/)
    expect(status.textContent).toMatch(/2 case-form moves finished/)
    expect(status.textContent).toMatch(/1 case form need a person/)
  })
})

describe('FormReleasePreImagePanel', () => {
  const snapshot = { _id: 's1', formCode: 'I-131', state: 'active', createdAt: '2026-10-20T10:00:00Z', dispositions: [{ disposition: 'carried', path: 'a' }, { disposition: 'carried', path: 'b' }] }
  const open = async () => {
    api.snapshots.mockResolvedValue({ data: { data: [snapshot] } })
    render(<FormReleaseSection forms={forms} />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 6ad8/), { target: { value: '6ad8ee536b1055b5fe8d3f81' } })
    fireEvent.click(screen.getByText('Show saved copies'))
    await screen.findByTestId('snapshot-list')
  }

  it('refuses a malformed case form id without calling the API', async () => {
    render(<FormReleaseSection forms={forms} />)
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 6ad8/), { target: { value: 'nope' } })
    fireEvent.click(screen.getByText('Show saved copies'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/24 letters/)
    expect(api.snapshots).not.toHaveBeenCalled()
  })

  it('restore is offered only after a clean preview, the preview never shows answer values, and a reason is required', async () => {
    api.restore.mockResolvedValueOnce({ data: { data: { dryRun: true, wouldRestore: true, changes: [{ path: 'answers.beneficiary.name', expected: 'SECRET-ONE', actual: 'SECRET-TWO' }] } } })
    await open()
    expect(screen.queryByText('Restore')).toBeNull()
    fireEvent.click(screen.getByText('Preview restore'))
    await screen.findByText(/can be restored/)
    expect(document.body.textContent).toContain('answers.beneficiary.name')
    expect(document.body.textContent).not.toMatch(/SECRET/)
    expect(api.restore).toHaveBeenCalledWith('s1', { dryRun: true })
    api.restore.mockResolvedValueOnce({ data: { data: { restored: true } } })
    fireEvent.click(screen.getByText('Restore'))
    fireEvent.click(screen.getByText('Yes, restore it'))
    expect(api.restore).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getAllByRole('textbox').pop(), { target: { value: 'Move lost the answers' } })
    fireEvent.click(screen.getByText('Yes, restore it'))
    await screen.findByText(/was restored from its saved copy/)
    expect(api.restore).toHaveBeenLastCalledWith('s1', { dryRun: false, reason: 'Move lost the answers' })
  })

  it('a form edited since the move cannot be restored (no Restore button)', async () => {
    api.restore.mockResolvedValueOnce({ data: { data: { dryRun: true, reconciliationRequired: true, changes: [{ path: 'x' }] } } })
    await open()
    fireEvent.click(screen.getByText('Preview restore'))
    await screen.findByText(/edited this case form since the migration/)
    expect(screen.queryByText('Restore')).toBeNull()
  })

  it('describeRestore keeps counts and paths only', () => {
    const out = describeRestore({ dryRun: true, wouldRestore: true, changes: Array.from({ length: 12 }, (_, i) => ({ path: `p${i}`, expected: 'v', actual: 'w' })) })
    expect(out.paths).toHaveLength(10)
    expect(out.count).toBe(12)
    expect(JSON.stringify(out)).not.toMatch(/"v"|"w"/)
    expect(describeRestore({ refused: 'SNAPSHOT_CHECKSUM_MISMATCH' }).tone).toBe('red')
    expect(describeRestore({ alreadyRestored: true }).text).toMatch(/nothing to restore/)
  })
})
