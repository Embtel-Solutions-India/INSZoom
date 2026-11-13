import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = { get: vi.fn(), post: vi.fn(), delete: vi.fn() }
vi.mock('../services/api', () => ({ default: { get: (...a) => api.get(...a), post: (...a) => api.post(...a), delete: (...a) => api.delete(...a) } }))
import CaseInvoices from './CaseInvoices'

const fromGhl = { url: 'https://connect.intuit.com/t/abc?locale=en_US&utm_source=sharelink', source: 'ghl', addedAt: '2026-11-07T10:00:00Z' }
const added = { url: 'https://example.com/invoice/2', source: 'crm', addedAt: '2026-11-08T10:00:00Z' }
const reply = (urls) => ({ data: { data: { urls } } })

beforeEach(() => {
  api.get.mockReset().mockResolvedValue(reply([fromGhl, added]))
  api.post.mockReset().mockResolvedValue(reply([fromGhl, added]))
  api.delete.mockReset().mockResolvedValue(reply([fromGhl]))
})

describe('CaseInvoices (invoice URLs)', () => {
  it('lists the invoice links: the one from GoHighLevel and the ones added here, each opening in a new browser tab', async () => {
    render(<CaseInvoices caseId="c1" title="B1 · Asha" onClose={() => {}} />)
    expect(await screen.findByText(fromGhl.url)).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith('/case-invoices/c1/urls')
    expect(screen.getByText(/From GoHighLevel/)).toBeTruthy()
    expect(screen.getByText(/Added here/)).toBeTruthy()
    const link = screen.getByText(fromGhl.url).closest('a')
    expect(link.getAttribute('href')).toBe(fromGhl.url)
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('no upload and no file list any more', async () => {
    render(<CaseInvoices caseId="c1" onClose={() => {}} />)
    await screen.findByText(fromGhl.url)
    expect(screen.queryByTestId('invoice-file-input')).toBeNull()
    expect(screen.queryByText('Add invoice')).toBeNull()
    expect(screen.queryByText('Download')).toBeNull()
  })

  it('with no link it says so', async () => {
    api.get.mockResolvedValue(reply([]))
    render(<CaseInvoices caseId="c1" onClose={() => {}} />)
    expect(await screen.findByText('No invoice URL has been submitted currently.')).toBeTruthy()
  })

  it('Add invoice URL: a text box and an Add button; the new link joins the list; an invalid one shows the server message', async () => {
    api.get.mockResolvedValue(reply([]))
    api.post.mockResolvedValueOnce(reply([added]))
    render(<CaseInvoices caseId="c1" onClose={() => {}} />)
    const input = await screen.findByTestId('invoice-url-input')
    expect(screen.getByText('Add invoice URL')).toBeTruthy()
    expect(screen.getByText('Add').closest('button').disabled).toBe(true)
    fireEvent.change(input, { target: { value: '  https://example.com/invoice/2  ' } })
    fireEvent.click(screen.getByText('Add'))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/case-invoices/c1/urls', { url: 'https://example.com/invoice/2' }))
    expect(await screen.findByText(added.url)).toBeTruthy()
    expect(screen.queryByText('No invoice URL has been submitted currently.')).toBeNull()
    expect(input.value).toBe('')

    api.post.mockRejectedValueOnce({ response: { data: { message: 'Enter a valid link starting with http:// or https://' } } })
    fireEvent.change(input, { target: { value: 'nope' } })
    fireEvent.click(screen.getByText('Add'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/valid link/)
  })

  it('every link can be removed (the server writes the change to the GoHighLevel card too)', async () => {
    render(<CaseInvoices caseId="c1" onClose={() => {}} />)
    await screen.findByText(added.url)
    expect(screen.getAllByLabelText('Remove invoice URL')).toHaveLength(2)
    fireEvent.click(screen.getAllByLabelText('Remove invoice URL')[1])
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/case-invoices/c1/urls', { params: { url: added.url } }))
    await waitFor(() => expect(screen.queryByText(added.url)).toBeNull())
  })
})
