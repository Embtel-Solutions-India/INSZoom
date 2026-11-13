import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const api = { tracking: vi.fn(), saveFedexNumber: vi.fn(), saveReceiptNumber: vi.fn(), submittedNotice: vi.fn() }
vi.mock('../services/api', () => ({
  lifecycleApi: {
    tracking: (...a) => api.tracking(...a),
    saveFedexNumber: (...a) => api.saveFedexNumber(...a),
    saveReceiptNumber: (...a) => api.saveReceiptNumber(...a),
  },
  ghlApi: { submittedNotice: (...a) => api.submittedNotice(...a) },
}))

import { FedexPromptProvider, useFedexPrompt } from '../contexts/FedexPromptContext'

function Trigger({ item }) {
  const { ask } = useFedexPrompt()
  return <button onClick={() => ask(item)}>trigger</button>
}
const open = (item) => {
  render(<FedexPromptProvider><Trigger item={item} /></FedexPromptProvider>)
  fireEvent.click(screen.getByText('trigger'))
}
const MOVE = { caseId: 'c1', caseNumber: 'B1', label: 'Asha', askClientEmail: true }

beforeEach(() => {
  api.tracking.mockReset().mockResolvedValue({ data: { tracking: { filing: {} } } })
  api.saveFedexNumber.mockReset().mockResolvedValue({ data: { success: true } })
  api.saveReceiptNumber.mockReset().mockResolvedValue({ data: { success: true } })
  api.submittedNotice.mockReset().mockResolvedValue({ data: { success: true, sent: true } })
})

describe('move to Submitted: how was it submitted?', () => {
  it('asks first, with two radios and a Continue that stays disabled until one is chosen', async () => {
    open(MOVE)
    expect(await screen.findByText('How did you submit the case?')).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByLabelText(/Online/)).toBeTruthy()
    expect(screen.getByLabelText(/FedEx/)).toBeTruthy()
    expect(screen.getByText('Continue').disabled).toBe(true)
    expect(screen.queryByText('Add the FedEx tracking number')).toBeNull()
  })

  it('Online -> USCIS receipt number (saved) -> e-mail choice that sends the ONLINE e-mail', async () => {
    open(MOVE)
    fireEvent.click(await screen.findByLabelText(/Online/))
    fireEvent.click(screen.getByText('Continue'))
    expect(await screen.findByText('Add the USCIS receipt number')).toBeTruthy()
    expect(screen.getByText(/You can add it later in that tab/)).toBeTruthy()
    // an invalid number is refused without calling the server
    fireEvent.change(screen.getByLabelText('USCIS receipt number'), { target: { value: 'IOE12' } })
    fireEvent.click(screen.getByText('Continue'))
    expect((await screen.findByRole('alert')).textContent).toMatch(/three letters followed by ten digits/)
    expect(api.saveReceiptNumber).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('USCIS receipt number'), { target: { value: 'ioe1234567890' } })
    fireEvent.click(screen.getByText('Continue'))
    await waitFor(() => expect(api.saveReceiptNumber).toHaveBeenCalledWith('c1', 'IOE1234567890'))
    // then the same "send the client an e-mail?" popup, in its online wording
    expect(await screen.findByText('Tell the client their case is complete?')).toBeTruthy()
    expect(screen.getByText(/has moved to Submitted \(online\)/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Send the client an e-mail/))
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => expect(api.submittedNotice).toHaveBeenCalledWith('c1', true, 'online'))
  })

  it('Online -> "Add later" saves nothing and still goes on to the e-mail question', async () => {
    open(MOVE)
    fireEvent.click(await screen.findByLabelText(/Online/))
    fireEvent.click(screen.getByText('Continue'))
    fireEvent.click(await screen.findByText('Add later'))
    expect(await screen.findByText('Tell the client their case is complete?')).toBeTruthy()
    expect(api.saveReceiptNumber).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText(/Don't inform the client/))
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => expect(api.submittedNotice).toHaveBeenCalledWith('c1', false, 'online'))
  })

  it('FedEx -> the ORIGINAL FedEx popup (number + amount) with a button that covers both -> the original e-mail choice', async () => {
    open(MOVE)
    fireEvent.click(await screen.findByLabelText(/FedEx/))
    fireEvent.click(screen.getByText('Continue'))
    expect(await screen.findByText('Add the FedEx tracking number')).toBeTruthy()
    expect(screen.getByLabelText(/FedEx amount/)).toBeTruthy()
    expect(screen.queryByText('Save tracking number')).toBeNull()
    fireEvent.change(screen.getByLabelText('FedEx tracking number'), { target: { value: '794644790138' } })
    fireEvent.click(screen.getByText('Save details'))
    await waitFor(() => expect(api.saveFedexNumber).toHaveBeenCalledWith('c1', '794644790138'))
    expect(await screen.findByText('Tell the client their case is complete?')).toBeTruthy()
    expect(screen.getByText(/has moved to Submitted \(FedEx\)/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/Send the client an e-mail/))
    fireEvent.click(screen.getByText('Confirm'))
    await waitFor(() => expect(api.submittedNotice).toHaveBeenCalledWith('c1', true, undefined))
  })

  it('the standalone "Add FedEx number" (no askClientEmail) is unchanged: straight to the FedEx popup, no question first', async () => {
    open({ caseId: 'c1', caseNumber: 'B1' })
    expect(await screen.findByText('Add the FedEx tracking number')).toBeTruthy()
    expect(screen.queryByText('How did you submit the case?')).toBeNull()
  })
})
