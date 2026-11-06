import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = { get: vi.fn(), post: vi.fn(), delete: vi.fn() }
vi.mock('../services/api', () => ({ default: { get: (...a) => api.get(...a), post: (...a) => api.post(...a), delete: (...a) => api.delete(...a) } }))
import CaseInvoices from './CaseInvoices'

const invoice = { _id: 'i1', fileName: 'Invoice-1.pdf', mimeType: 'application/pdf', size: 20480, createdAt: '2026-11-07T10:00:00Z', uploadedBy: { name: 'Asha' } }

beforeEach(() => {
  api.get.mockReset().mockImplementation((url) => (url.includes('/file') ? Promise.resolve({ data: new Blob(['x'], { type: 'application/pdf' }) }) : Promise.resolve({ data: { data: [invoice] } })))
  api.post.mockReset().mockResolvedValue({ data: { data: invoice } })
  api.delete.mockReset().mockResolvedValue({ data: { success: true } })
  global.URL.createObjectURL = vi.fn(() => 'blob:x')
  global.URL.revokeObjectURL = vi.fn()
})

describe('CaseInvoices', () => {
  it('lists the invoices of the case with View and Download', async () => {
    render(<CaseInvoices caseId="c1" title="B1 · Asha" onClose={() => {}} />)
    expect(await screen.findByText('Invoice-1.pdf')).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith('/case-invoices/c1')
    expect(screen.getByText('View')).toBeTruthy()
    expect(screen.getByLabelText('Download Invoice-1.pdf')).toBeTruthy()
  })

  it('shows an empty state', async () => {
    api.get.mockResolvedValue({ data: { data: [] } })
    render(<CaseInvoices caseId="c1" onClose={() => {}} />)
    expect(await screen.findByText('No invoices yet')).toBeTruthy()
  })

  it('uploads the chosen file to that case', async () => {
    render(<CaseInvoices caseId="c1" onClose={() => {}} />)
    await screen.findByText('Invoice-1.pdf')
    fireEvent.change(screen.getByTestId('invoice-file-input'), { target: { files: [new File(['a'], 'new.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => expect(api.post).toHaveBeenCalled())
    expect(api.post.mock.calls[0][0]).toBe('/case-invoices/c1')
  })

  it('Delete asks first, then removes the invoice from the list', async () => {
    render(<CaseInvoices caseId="c1" onClose={() => {}} />)
    fireEvent.click(await screen.findByLabelText('Delete Invoice-1.pdf'))
    expect(await screen.findByTestId('invoice-delete-confirm')).toBeTruthy()
    expect(api.delete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Delete', { selector: 'button:not([aria-label])' }))
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/case-invoices/c1/i1'))
    await waitFor(() => expect(screen.queryByText('Invoice-1.pdf')).toBeNull())
  })

  it('Cancel keeps the invoice', async () => {
    render(<CaseInvoices caseId="c1" onClose={() => {}} />)
    fireEvent.click(await screen.findByLabelText('Delete Invoice-1.pdf'))
    fireEvent.click(await screen.findByText('Cancel'))
    expect(api.delete).not.toHaveBeenCalled()
    expect(screen.getByText('Invoice-1.pdf')).toBeTruthy()
  })

  it('View opens the full-screen viewer, and the cross closes it', async () => {
    render(<CaseInvoices caseId="c1" onClose={() => {}} />)
    fireEvent.click(await screen.findByText('View'))
    expect(await screen.findByTestId('invoice-viewer')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Close invoice'))
    await waitFor(() => expect(screen.queryByTestId('invoice-viewer')).toBeNull())
  })
})
