import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const api = { tracking: vi.fn(), saveFedexNumber: vi.fn() }
vi.mock('../services/api', () => ({ lifecycleApi: { tracking: (...a) => api.tracking(...a), saveFedexNumber: (...a) => api.saveFedexNumber(...a) } }))

import { FedexPromptProvider, useFedexPrompt } from '../contexts/FedexPromptContext'

function Trigger({ items }) {
  const { ask } = useFedexPrompt()
  return <button onClick={() => items.forEach((item) => ask(item))}>trigger</button>
}
const open = (items) => {
  render(<FedexPromptProvider><Trigger items={items} /></FedexPromptProvider>)
  fireEvent.click(screen.getByText('trigger'))
}

beforeEach(() => {
  api.tracking.mockReset().mockResolvedValue({ data: { tracking: { filing: {} } } })
  api.saveFedexNumber.mockReset().mockResolvedValue({ data: { success: true } })
})

describe('FedexNumberModal', () => {
  it('opens automatically with the case and the Tracking-tab note', async () => {
    open([{ caseId: 'c1', caseNumber: 'B413-A', label: 'Asha Rao' }])
    expect(await screen.findByText('Add the FedEx tracking number')).toBeTruthy()
    expect(screen.getByText(/B413-A · Asha Rao/)).toBeTruthy()
    expect(screen.getByText(/To change it later, update it there\./)).toBeTruthy()
  })

  it('refuses an invalid number without calling the server', async () => {
    open([{ caseId: 'c1', caseNumber: 'B1' }])
    const input = await screen.findByLabelText('FedEx tracking number')
    fireEvent.change(input, { target: { value: '12' } })
    fireEvent.click(screen.getByText('Save details'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(api.saveFedexNumber).not.toHaveBeenCalled()
    expect(screen.getByTestId('fedex-number-modal')).toBeTruthy()
  })

  it('saves a valid number for THAT case, announces it, and closes', async () => {
    const saved = vi.fn()
    window.addEventListener('fedex-number-saved', saved)
    open([{ caseId: 'c1', caseNumber: 'B1' }])
    fireEvent.change(await screen.findByLabelText('FedEx tracking number'), { target: { value: '7946 4479 0138' } })
    fireEvent.click(screen.getByText('Save details'))
    await waitFor(() => expect(api.saveFedexNumber).toHaveBeenCalledWith('c1', '7946 4479 0138'))
    await waitFor(() => expect(screen.queryByTestId('fedex-number-modal')).toBeNull())
    expect(saved).toHaveBeenCalledTimes(1)
    expect(saved.mock.calls[0][0].detail).toEqual({ caseId: 'c1' })
    window.removeEventListener('fedex-number-saved', saved)
  })

  it('shows the server error and stays open when saving fails', async () => {
    api.saveFedexNumber.mockRejectedValue({ response: { data: { message: 'Access denied' } } })
    open([{ caseId: 'c1', caseNumber: 'B1' }])
    fireEvent.change(await screen.findByLabelText('FedEx tracking number'), { target: { value: '794644790138' } })
    fireEvent.click(screen.getByText('Save details'))
    expect((await screen.findByRole('alert')).textContent).toBe('Access denied')
    expect(screen.getByTestId('fedex-number-modal')).toBeTruthy()
  })

  it('"Add later" closes without saving', async () => {
    open([{ caseId: 'c1', caseNumber: 'B1' }])
    fireEvent.click(await screen.findByText('Add later'))
    await waitFor(() => expect(screen.queryByTestId('fedex-number-modal')).toBeNull())
    expect(api.saveFedexNumber).not.toHaveBeenCalled()
  })

  it('pre-fills a number already on file (edited, never lost)', async () => {
    api.tracking.mockResolvedValue({ data: { tracking: { filing: { carrier: 'fedex', trackingNumber: '794644790138' } } } })
    open([{ caseId: 'c1', caseNumber: 'B1' }])
    await waitFor(() => expect(screen.getByLabelText('FedEx tracking number').value).toBe('7946 4479 0138'))
  })

  it('several cases are asked one after the other, and the same case is never queued twice', async () => {
    open([{ caseId: 'c1', caseNumber: 'B1' }, { caseId: 'c1', caseNumber: 'B1' }, { caseId: 'c2', caseNumber: 'B2' }])
    expect(await screen.findByText(/B1/)).toBeTruthy()
    fireEvent.click(screen.getByText('Add later'))
    expect(await screen.findByText(/B2/)).toBeTruthy()
    fireEvent.click(screen.getByText('Add later'))
    await waitFor(() => expect(screen.queryByTestId('fedex-number-modal')).toBeNull())
  })

  it('ask() without a case id does nothing', async () => {
    open([{ caseNumber: 'B1' }])
    await act(async () => {})
    expect(screen.queryByTestId('fedex-number-modal')).toBeNull()
  })
})
