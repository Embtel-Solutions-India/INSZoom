import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = { get: vi.fn() }
vi.mock('../services/api', () => ({ default: { get: (...a) => api.get(...a) } }))
vi.mock('./CaseInvoices', () => ({ default: ({ caseId }) => <div data-testid="invoices-open">{caseId}</div> }))
import EmployerPaymentSummary from './EmployerPaymentSummary'

const data = { employees: [
  { _id: 'e1', caseNumber: 'B1-A', name: 'Asha', totalAmount: 1000, uscisFee: 200, amountPaid: 400, outstanding: 600 },
  { _id: 'e2', caseNumber: 'B1-B', name: 'Ravi', totalAmount: 500, uscisFee: 100, amountPaid: 500, outstanding: 0 },
], totals: { totalAmount: 1500, uscisFee: 300, amountPaid: 900, outstanding: 600 } }

beforeEach(() => api.get.mockReset().mockResolvedValue({ data: { data } }))

describe('EmployerPaymentSummary', () => {
  it('shows the accumulated totals and a row per employee', async () => {
    render(<MemoryRouter><EmployerPaymentSummary caseId="p1" /></MemoryRouter>)
    expect(await screen.findByText('$1,500')).toBeTruthy()
    expect(api.get).toHaveBeenCalledWith('/case-invoices/p1/employee-payments')
    expect(screen.getAllByTestId('employee-payment-row')).toHaveLength(2)
    expect(screen.getByText('Asha')).toBeTruthy()
  })
  it("an employee's Invoices button opens that employee's invoices", async () => {
    render(<MemoryRouter><EmployerPaymentSummary caseId="p1" /></MemoryRouter>)
    await screen.findAllByTestId('employee-payment-row')
    fireEvent.click(screen.getAllByText('Invoices')[2])
    expect((await screen.findByTestId('invoices-open')).textContent).toBe('e2')
  })
  it("the principal's own Invoices button opens only the principal's invoices", async () => {
    render(<MemoryRouter><EmployerPaymentSummary caseId="p1" /></MemoryRouter>)
    await screen.findAllByTestId('employee-payment-row')
    fireEvent.click(screen.getAllByText('Invoices')[0])
    expect((await screen.findByTestId('invoices-open')).textContent).toBe('p1')
  })
})
