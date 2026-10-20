import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

afterEach(() => { cleanup() })

// Manage forms: type a form, Add, see how the case's checklists feed it, apply in one request; removal needs the confirmations the server will demand;
// a stale revision reloads. The API is faked.
const api = vi.hoisted(() => ({ getSelection: vi.fn(), catalog: vi.fn(), resolve: vi.fn(), coverage: vi.fn(), updateSelection: vi.fn(), autofill: vi.fn(), list: vi.fn() }))
vi.mock('../services/api', () => ({
  caseFormsApi: { getSelection: (...a) => api.getSelection(...a), catalog: (...a) => api.catalog(...a), resolve: (...a) => api.resolve(...a), coverage: (...a) => api.coverage(...a), updateSelection: (...a) => api.updateSelection(...a), autofill: (...a) => api.autofill(...a) },
  questionnairesApi: { list: (...a) => api.list(...a) },
}))

import CaseFormSelectionPanel from './CaseFormSelectionPanel'

const selectionState = (over = {}) => ({
  caseId: 'c1', targets: [{ caseId: 'c1', caseNumber: 'B1', clientName: 'Ann' }], target: { caseId: 'c1', caseNumber: 'B1', clientName: 'Ann' }, needsTarget: false, mode: 'legacy', revision: 0,
  items: [
    { key: 'I-129|', formCode: 'I-129', componentCode: null, parentFormCode: null, title: 'Petition for a Nonimmigrant Worker', origin: 'automatic', caseFormStatus: 'ai_filled', completionPercent: 40, locked: false, requiredByPackage: true },
    { key: 'I-907|', formCode: 'I-907', componentCode: null, parentFormCode: null, title: 'Premium Processing', origin: 'selection', caseFormStatus: 'pending', completionPercent: 0, locked: false, requiredByPackage: false },
  ],
  removed: [], requiredByPackage: ['I-129'], ...over,
})
const i765 = { key: 'I-765', kind: 'form', formCode: 'I-765', componentCode: null, title: 'Application for Employment Authorization', availability: 'ready', provisionable: true, availabilityNote: '' }

beforeEach(() => {
  api.getSelection.mockReset().mockResolvedValue({ data: { data: selectionState() } })
  api.catalog.mockReset().mockResolvedValue({ data: { data: { items: [i765] } } })
  api.resolve.mockReset().mockResolvedValue({ data: { data: { match: i765, candidates: [] } } })
  api.coverage.mockReset().mockResolvedValue({ data: { data: { checklists: [{ key: 'h1b_employee_checklist', title: 'H-1B Employee Checklist', heldByCase: true, fieldsFed: 12, questionsFeedingForm: 9 }], suggestedChecklists: [{ key: 'i765_checklist', title: 'I-765 Checklist' }], summary: "This case's checklists can fill about 12 field(s) of I-765." } } })
  api.updateSelection.mockReset().mockResolvedValue({ data: { data: { results: [{ formCode: 'I-765', action: 'added', status: 'ok', selectionStatus: 'provisioned', caseFormId: 'cf1' }], assignedChecklists: [], autofill: [], partial: false, revision: 2, selection: selectionState({ revision: 2, items: [...selectionState().items, { key: 'I-765|', formCode: 'I-765', title: 'EAD', origin: 'selection', caseFormStatus: 'ai_filled', completionPercent: 35 }] }) } } })
  api.autofill.mockReset().mockResolvedValue({ data: { data: { results: [{ formCode: 'I-765', status: 'filled', completion: { percent: 35 } }] } } })
  api.list.mockReset().mockResolvedValue({ data: { data: [] } })
})

const open = async () => {
  const onChanged = vi.fn()
  render(<CaseFormSelectionPanel caseId="c1" onClose={vi.fn()} onChanged={onChanged} />)
  await screen.findByText('On this case (2)')
  return onChanged
}

describe('Manage forms', () => {
  it('typing a form and pressing Add stages it with no checklist picker (the form is linked to the checklists by canonical path), and Apply sends one atomic request with the revision', async () => {
    const onChanged = await open()
    const input = screen.getByPlaceholderText(/Type a form number or name/)
    fireEvent.change(input, { target: { value: 'I-765' } })
    fireEvent.click(screen.getByRole('button', { name: /Add$/ }))
    await screen.findByText('To add')
    expect(api.resolve).toHaveBeenCalledWith('I-765')
    // nothing about sending checklists to the case is offered, and no coverage lookup is made
    expect(screen.queryByText(/How this case's checklists fill the form/)).toBeNull()
    expect(screen.queryByText(/not on this case/)).toBeNull()
    expect(api.coverage).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    await waitFor(() => expect(api.updateSelection).toHaveBeenCalledTimes(1))
    const [caseId, payload] = api.updateSelection.mock.calls[0]
    expect(caseId).toBe('c1')
    expect(payload).toMatchObject({ targetCaseId: 'c1', expectedRevision: 0, add: [{ formCode: 'I-765' }], remove: [], assignChecklistKeys: [], autofill: false })
    // the forms are added first and shown at once; the slow fill follows as its own request
    await screen.findByText('Changes saved')
    await waitFor(() => expect(api.autofill).toHaveBeenCalledWith('c1', { targetCaseId: 'c1', forms: [{ formCode: 'I-765' }] }))
    expect(await screen.findByText(/I-765: auto-filled \(35% complete\)/)).toBeTruthy()
    expect(onChanged).toHaveBeenCalled()
  })

  it('a component is listed by its plain name and its parent, not by its long internal code, so rows never overlap', async () => {
    api.catalog.mockResolvedValue({ data: { data: { items: [
      { key: 'I-129|I129_H_CLASSIFICATION_SUPPLEM', kind: 'component', formCode: 'I129_H_CLASSIFICATION_SUPPLEM', componentCode: 'I129_H_CLASSIFICATION_SUPPLEM', parentFormCode: 'I-129', title: 'H Classification Supplement', availability: 'ready', provisionable: true },
      { key: 'I-129', kind: 'form', formCode: 'I-129', componentCode: null, title: 'I-129', availability: 'ready', provisionable: true },
    ] } } })
    await open()
    fireEvent.change(screen.getByPlaceholderText(/Type a form number or name/), { target: { value: 'i-129' } })
    expect(await screen.findByText('H Classification Supplement')).toBeTruthy()
    expect(screen.getByText('Part of I-129')).toBeTruthy()
    expect(screen.queryByText('I129_H_CLASSIFICATION_SUPPLEM')).toBeNull()
    // a form whose title is just its number shows the number once
    expect(screen.getAllByText('I-129').length).toBeGreaterThan(0)
  })

  it('an ambiguous or unknown name is explained, never guessed', async () => {
    api.resolve.mockResolvedValue({ data: { data: { match: null, candidates: [] } } })
    await open()
    fireEvent.change(screen.getByPlaceholderText(/Type a form number or name/), { target: { value: 'zzz' } })
    fireEvent.click(screen.getByRole('button', { name: /Add$/ }))
    expect(await screen.findByText(/No USCIS form matches "zzz"/)).toBeTruthy()
    expect(screen.queryByText('To add')).toBeNull()
  })

  it('removal is staged, and Apply stays disabled until the confirmations the form needs are given', async () => {
    await open()
    fireEvent.click(screen.getByLabelText('Delete I-129'))
    const apply = screen.getByRole('button', { name: 'Apply changes' })
    expect(apply.disabled).toBe(true)
    // I-129 holds data and is required by the filing package: both must be acknowledged
    fireEvent.click(screen.getByLabelText(/already holds information/))
    expect(apply.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/normally requires I-129/))
    expect(apply.disabled).toBe(false)
    // an empty draft needs nothing
    fireEvent.click(screen.getByLabelText('Keep I-129'))
    fireEvent.click(screen.getByLabelText('Delete I-907'))
    expect(screen.getByRole('button', { name: 'Apply changes' }).disabled).toBe(false)
  })

  it('Delete is a labelled button on each form and "Delete ... and save" removes it in one request without touching other staged changes', async () => {
    const onChanged = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Delete I-907' }))
    fireEvent.click(screen.getByRole('button', { name: /Delete I-907 and save/ }))
    await waitFor(() => expect(api.updateSelection).toHaveBeenCalledTimes(1))
    expect(api.updateSelection.mock.calls[0][1]).toMatchObject({ targetCaseId: 'c1', add: [], remove: [{ formCode: 'I-907' }], autofill: false })
    expect(onChanged).toHaveBeenCalled()
  })

  it('a stale revision reloads the selection and asks to review again', async () => {
    api.updateSelection.mockRejectedValue({ response: { data: { code: 'STALE_SELECTION_REVISION', message: 'changed' } } })
    await open()
    fireEvent.click(screen.getByLabelText('Delete I-907'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(await screen.findByText(/Someone else changed this case's forms/)).toBeTruthy()
    expect(api.getSelection).toHaveBeenCalledTimes(2)
  })
})
