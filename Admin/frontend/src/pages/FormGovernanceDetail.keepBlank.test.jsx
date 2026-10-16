import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

afterEach(() => { cleanup() })

// "Keep blank" on a form's mapping table: a button per box, a confirmation that explains what happens and asks (optionally) why, the row then shows "Kept blank" with an
// undo, and mapping the box through the dropdown still works as before. The API is faked.
const api = vi.hoisted(() => ({ catalog: vi.fn(), mappingPreview: vi.fn(), keepBlank: vi.fn(), upsertMapping: vi.fn() }))
vi.mock('../services/api', () => ({
  formGovernanceApi: {
    catalog: (...a) => api.catalog(...a), mappingPreview: (...a) => api.mappingPreview(...a), keepBlank: (...a) => api.keepBlank(...a), upsertMapping: (...a) => api.upsertMapping(...a),
    checklistTraceFields: vi.fn().mockResolvedValue({ data: { fields: [] } }), governanceDefects: vi.fn().mockResolvedValue({ data: { defects: [], intentionalGaps: [] } }),
    mappingCoverage: vi.fn().mockResolvedValue({ data: { coverage: {} } }), visaRegistry: vi.fn().mockResolvedValue({ data: { visaTypes: [] } }),
  },
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { role: 'admin' } }) }))
vi.mock('../components/UploadFormModal', () => ({ default: () => null }))
vi.mock('../components/MappingCoveragePanel', () => ({ default: () => null }))
vi.mock('./FormGovernance', () => ({ associationLabel: () => '' }))

import FormGovernanceDetail from './FormGovernanceDetail'

const graph = (over = {}) => ({
  summary: {}, keepBlank: [], edges: [{ mappingId: 'm1', targetFieldId: 'given', sourcePath: 'person.firstName', status: 'active' }],
  nodes: { canonical: [{ path: 'person.firstName' }], form: [{ fieldId: 'given', label: 'Given Name', section: 'Part 1', pageNumber: 1 }, { fieldId: 'mid', label: 'Middle Name', section: 'Part 1', pageNumber: 1 }] }, ...over,
})

const open = async () => {
  render(<MemoryRouter initialEntries={['/forms/I-130']}><Routes><Route path="/forms/:formCode" element={<FormGovernanceDetail />} /></Routes></MemoryRouter>)
  await screen.findByText('Middle Name')
}
const rowOf = (label) => screen.getByText(label).closest('tr')

beforeEach(() => {
  api.catalog.mockReset().mockResolvedValue({ data: { data: [{ formCode: 'I-130', templateId: 't1', title: 'Petition', associations: [] }] } })
  api.mappingPreview.mockReset().mockResolvedValue({ data: { graph: graph(), template: { mappingStatus: 'active' } } })
  api.keepBlank.mockReset().mockResolvedValue({ data: { graph: graph({ edges: [], keepBlank: [{ targetFieldId: 'given' }] }) } })
})

describe('Keep blank on the mapping table', () => {
  it('asks first, explains what happens, and saves the decision with the optional reason', async () => {
    await open()
    fireEvent.click(within(rowOf('Given Name')).getByRole('button', { name: 'Keep blank' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/Nothing will ever be stored in this box/)
    expect(dialog.textContent).toMatch(/person\.firstName, is removed/)
    expect(api.keepBlank).not.toHaveBeenCalled()
    fireEvent.change(within(dialog).getByLabelText(/Why/), { target: { value: 'USCIS says leave empty' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep blank' }))
    await waitFor(() => expect(api.keepBlank).toHaveBeenCalledWith('t1', 'given', { keepBlank: true, reason: 'USCIS says leave empty' }))
    await waitFor(() => expect(within(rowOf('Given Name')).getByText('Kept blank')).toBeTruthy())
    expect(screen.getByText(/will be kept blank/)).toBeTruthy()
  })

  it('cancelling changes nothing', async () => {
    await open()
    fireEvent.click(within(rowOf('Middle Name')).getByRole('button', { name: 'Keep blank' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.keepBlank).not.toHaveBeenCalled()
  })

  it('a kept-blank box shows an undo that takes the decision back', async () => {
    api.mappingPreview.mockResolvedValue({ data: { graph: graph({ edges: [], keepBlank: [{ targetFieldId: 'given' }] }), template: { mappingStatus: 'active' } } })
    api.keepBlank.mockResolvedValue({ data: { graph: graph({ edges: [], keepBlank: [] }) } })
    await open()
    const row = rowOf('Given Name')
    expect(within(row).getByText('Kept blank')).toBeTruthy()
    expect(within(row).queryByRole('button', { name: 'Keep blank' })).toBeNull()
    fireEvent.click(within(row).getByRole('button', { name: 'Undo keep blank' }))
    await waitFor(() => expect(api.keepBlank).toHaveBeenCalledWith('t1', 'given', { keepBlank: false, reason: '' }))
    await waitFor(() => expect(within(rowOf('Given Name')).getByText('Unmapped')).toBeTruthy())
  })

  it('an error is shown and the table is left as it was', async () => {
    api.keepBlank.mockRejectedValue({ response: { data: { message: 'USCIS target field not found' } } })
    await open()
    fireEvent.click(within(rowOf('Middle Name')).getByRole('button', { name: 'Keep blank' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep blank' }))
    expect(await screen.findByText('USCIS target field not found')).toBeTruthy()
    expect(within(rowOf('Middle Name')).queryByText('Kept blank')).toBeNull()
  })
})
