import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'

afterEach(() => { cleanup() })

// A matter whose employees are on different visas lists every assigned checklist (the second employee's own included), and scrolls past five. The API is faked.
const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('../services/api', () => ({
  questionnairesApi: { listCaseChecklists: (...a) => api.list(...a), approveCaseChecklists: vi.fn(), removeCaseChecklist: vi.fn() },
  invalidateCachedGet: vi.fn(),
}))
vi.mock('./ChecklistEditorModal', () => ({ default: () => null }))
vi.mock('./ConfirmModal', () => ({ default: () => null }))

import ChecklistApprovalCard from './ChecklistApprovalCard'

const item = (id, title, role, over = {}) => ({ checklistId: id, title, targetRole: role, clientApproval: 'draft', ...over })
const principalItems = [item('l1b|employer', 'L-1B Employer Checklist', 'employer'), item('l1b|employee', 'L-1B Employee Checklist', 'employee')]
const children = [{ _id: 'c1', caseNumber: 'B1-A', clientName: 'Ana' }, { _id: 'c2', caseNumber: 'B1-B', employeeContact: { name: 'Raj' } }]

beforeEach(() => {
  api.list.mockReset().mockImplementation(async (id) => ({
    data: { data: { checklists: id === 'c1' ? [item('l1b|employee', 'L-1B Employee Checklist', 'employee')] : [item('p|employee', 'P Visa Employee Checklist', 'employee')] } },
  }))
})

describe('Checklists for this case', () => {
  it("also lists the second employee's own checklist, once, and not a checklist the matter already shows", async () => {
    render(<ChecklistApprovalCard caseId="m1" checklists={principalItems} childCases={children} onChanged={vi.fn()} />)
    expect(await screen.findByText('P Visa Employee Checklist')).toBeTruthy()
    expect(screen.getAllByText('L-1B Employee Checklist')).toHaveLength(1)
    expect(screen.getByText(/Raj/)).toBeTruthy()
  })

  it('shows every checklist and only scrolls inside the card once there are more than five', async () => {
    const many = Array.from({ length: 6 }, (_, i) => item(`k${i}|employer`, `Checklist ${i}`, 'employer'))
    const { rerender } = render(<ChecklistApprovalCard caseId="m1" checklists={many} childCases={[]} onChanged={vi.fn()} />)
    expect(await screen.findByText('Checklist 5')).toBeTruthy()
    expect(screen.getByTestId('checklist-approval-list').className).toMatch(/overflow-y-auto/)
    rerender(<ChecklistApprovalCard caseId="m1" checklists={many.slice(0, 4)} childCases={[]} onChanged={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('checklist-approval-list').className).not.toMatch(/overflow-y-auto/))
  })
})
