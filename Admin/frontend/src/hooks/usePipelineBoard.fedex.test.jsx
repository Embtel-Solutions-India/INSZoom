import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const socketValue = { connected: true, subscribe: () => () => {} }
vi.mock('../contexts/SocketContext', () => ({ useSocket: () => socketValue }))
const ask = vi.fn()
vi.mock('../contexts/FedexPromptContext', () => ({ useFedexPrompt: () => ({ ask }) }))
const api = { board: vi.fn(), moveStage: vi.fn() }
vi.mock('../services/api', () => ({ ghlApi: { board: (...a) => api.board(...a), moveStage: (...a) => api.moveStage(...a) } }))

import usePipelineBoard from './usePipelineBoard'

const board = () => ({
  data: {
    configured: true, activeCategory: 'immigrant', pipelines: [{ category: 'immigrant', name: 'Immigrant', total: 1 }],
    columns: [
      { key: 'docs', name: 'Docs', total: 1, hasMore: false, cards: [{ _id: 'c1', clientName: 'Asha Rao', employerName: 'Acme Inc', caseNumber: 'B413-A', unifiedStageKey: 'docs', syncStatus: 'SYNCED' }] },
      { key: 'submitted_fedex', name: 'Submitted (FedEx)', total: 0, hasMore: false, cards: [] },
      { key: 'receipt_tracking', name: 'Receipt tracking', total: 0, hasMore: false, cards: [] },
    ],
  },
})
const mount = async () => {
  const hook = renderHook(() => usePipelineBoard('immigrant'))
  await waitFor(() => expect(hook.result.current.columns.length).toBe(3))
  return hook
}

beforeEach(() => {
  ask.mockReset()
  api.board.mockReset().mockResolvedValue(board())
  api.moveStage.mockReset()
})

describe('usePipelineBoard - Submitted (FedEx) asks for the FedEx number', () => {
  it('asks once the server has accepted the move into Submitted (FedEx), with the card details', async () => {
    api.moveStage.mockResolvedValue({ data: { card: { syncStatus: 'SYNCED' } } })
    const hook = await mount()
    await act(async () => hook.result.current.moveCard('c1', 'submitted_fedex'))
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(1))
    expect(ask).toHaveBeenCalledWith({ caseId: 'c1', caseNumber: 'B413-A', label: 'Asha Rao · Acme Inc', askClientEmail: true })
  })

  it('does not ask for a move to any other stage', async () => {
    api.moveStage.mockResolvedValue({ data: {} })
    const hook = await mount()
    await act(async () => hook.result.current.moveCard('c1', 'receipt_tracking'))
    await waitFor(() => expect(api.moveStage).toHaveBeenCalled())
    expect(ask).not.toHaveBeenCalled()
  })

  it('does not ask when the move is refused (the card goes back and nothing is asked)', async () => {
    api.moveStage.mockRejectedValue(new Error('refused'))
    const hook = await mount()
    await act(async () => hook.result.current.moveCard('c1', 'submitted_fedex'))
    await waitFor(() => expect(api.moveStage).toHaveBeenCalled())
    expect(ask).not.toHaveBeenCalled()
  })

  it('a failing prompt can never fail the move', async () => {
    api.moveStage.mockResolvedValue({ data: {} })
    ask.mockImplementation(() => { throw new Error('prompt broke') })
    const hook = await mount()
    await act(async () => hook.result.current.moveCard('c1', 'submitted_fedex'))
    await waitFor(() => expect(ask).toHaveBeenCalled())
    expect(hook.result.current.columns.find((c) => c.key === 'submitted_fedex').cards.map((c) => c._id)).toEqual(['c1'])
  })
})
