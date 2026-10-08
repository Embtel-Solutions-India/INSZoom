import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

const handlers = {}
// Stable identities, exactly like the real SocketContext (useCallback/useMemo), so the hook's effects don't re-run every render.
const socketValue = { connected: true, subscribe: (event, handler) => { handlers[event] = handler; return () => { delete handlers[event] } } }
vi.mock('../contexts/SocketContext', () => ({ useSocket: () => socketValue }))

const api = { board: vi.fn(), moveStage: vi.fn() }
vi.mock('../services/api', () => ({ ghlApi: { board: (...a) => api.board(...a), moveStage: (...a) => api.moveStage(...a) } }))

import usePipelineBoard from './usePipelineBoard'

const card = (id, key) => ({ _id: id, clientName: `Client ${id}`, caseNumber: id, unifiedStageKey: key, syncStatus: 'SYNCED' })
const boardData = () => ({
  data: {
    configured: true,
    activeCategory: 'immigrant',
    pipelines: [{ category: 'immigrant', name: 'Immigrant', total: 2 }, { category: 'non_immigrant', name: 'Non-Immigrant', total: 5 }],
    columns: [
      { key: 'a', name: 'A', total: 2, hasMore: false, cards: [card('c1', 'a'), card('c2', 'a')] },
      { key: 'b', name: 'B', total: 0, hasMore: false, cards: [] },
      { key: 'c', name: 'C', total: 0, hasMore: false, cards: [] },
    ],
  },
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const ids = (hook, key) => hook.result.current.columns.find((c) => c.key === key).cards.map((c) => c._id)
const total = (hook, key) => hook.result.current.columns.find((c) => c.key === key).total

const mount = async (category) => {
  const hook = renderHook(() => usePipelineBoard(category))
  await waitFor(() => expect(hook.result.current.columns.length).toBe(3))
  return hook
}

beforeEach(() => {
  api.board.mockReset().mockResolvedValue(boardData())
  api.moveStage.mockReset()
  Object.keys(handlers).forEach((k) => delete handlers[k])
})

describe('usePipelineBoard', () => {
  it('loads the board', async () => {
    const hook = await mount()
    expect(ids(hook, 'a')).toEqual(['c1', 'c2'])
    expect(hook.result.current.status.loading).toBe(false)
  })

  it('moves the card INSTANTLY, before the server has answered', async () => {
    const hook = await mount()
    const pending = deferred()
    api.moveStage.mockReturnValue(pending.promise) // the backend has not responded yet
    act(() => hook.result.current.moveCard('c1', 'b'))
    expect(ids(hook, 'a')).toEqual(['c2'])
    expect(ids(hook, 'b')).toEqual(['c1'])
    expect([total(hook, 'a'), total(hook, 'b')]).toEqual([1, 1])
    await act(async () => pending.resolve({ data: { card: { syncStatus: 'PENDING' } } }))
    expect(ids(hook, 'b')).toEqual(['c1']) // success changes nothing visible
    expect(hook.result.current.notice).toBeNull()
  })

  it('sends our own backend the stage key and a moveId, never anything GHL-specific', async () => {
    const hook = await mount()
    api.moveStage.mockResolvedValue({ data: { card: {} } })
    await act(async () => hook.result.current.moveCard('c1', 'b'))
    expect(api.moveStage).toHaveBeenCalledWith('c1', { unifiedStageKey: 'b', moveId: expect.any(String) })
  })

  it('rolls the card back and says why when OUR backend rejects the move', async () => {
    const hook = await mount()
    api.moveStage.mockRejectedValue({ response: { status: 403, data: { message: 'Not authorized to move this case' } } })
    await act(async () => hook.result.current.moveCard('c1', 'b'))
    expect(ids(hook, 'a')).toContain('c1')
    expect(ids(hook, 'b')).toEqual([])
    expect(total(hook, 'a')).toBe(2)
    expect(hook.result.current.notice.text).toMatch(/Not authorized/)
  })

  it('last drop wins: a move overtaken by a newer drop of the same card is never sent', async () => {
    const hook = await mount()
    const first = deferred()
    api.moveStage.mockReturnValueOnce(first.promise).mockResolvedValue({ data: { card: {} } })
    act(() => hook.result.current.moveCard('c1', 'b')) // request 1 in flight
    await act(async () => {}) // a human drags at human speed: request 1 really goes out before the next drop
    act(() => hook.result.current.moveCard('c1', 'c')) // queued, then overtaken
    act(() => hook.result.current.moveCard('c1', 'a')) // the final intent
    expect(ids(hook, 'a')).toContain('c1') // UI already shows the last drop
    await act(async () => first.resolve({ data: { card: {} } }))
    await waitFor(() => expect(api.moveStage).toHaveBeenCalledTimes(2))
    expect(api.moveStage.mock.calls.map((c) => c[1].unifiedStageKey)).toEqual(['b', 'a']) // 'c' was never sent
    expect(ids(hook, 'a')).toContain('c1')
  })

  it('dragging a card and dropping it back where the server has it sends nothing', async () => {
    const hook = await mount()
    act(() => hook.result.current.moveCard('c1', 'b'))
    act(() => hook.result.current.moveCard('c1', 'a'))
    await act(async () => {})
    expect(api.moveStage).not.toHaveBeenCalled()
    expect(ids(hook, 'a')).toContain('c1')
  })

  it('does not yank the board with a server snapshot while a move is in flight, then reconciles after', async () => {
    const hook = await mount()
    const pending = deferred()
    api.moveStage.mockReturnValue(pending.promise)
    act(() => hook.result.current.moveCard('c1', 'b'))
    api.board.mockClear()
    act(() => handlers['ghl:pipeline:updated']({ caseId: 'c9', source: 'ghl' })) // someone else changed something
    await new Promise((r) => setTimeout(r, 350))
    expect(api.board).not.toHaveBeenCalled() // held back while our move is in flight
    expect(ids(hook, 'b')).toEqual(['c1'])
    await act(async () => pending.resolve({ data: { card: {} } }))
    // Nothing failed, so no forced reload; a later event refreshes normally.
    act(() => handlers['ghl:pipeline:updated']({ caseId: 'c9', source: 'ghl' }))
    await waitFor(() => expect(api.board).toHaveBeenCalledTimes(1))
  })

  it('ignores the echo of its own move but reacts to everyone else', async () => {
    const hook = await mount()
    api.moveStage.mockResolvedValue({ data: { card: {} } })
    await act(async () => hook.result.current.moveCard('c1', 'b'))
    const ownMoveId = api.moveStage.mock.calls[0][1].moveId
    api.board.mockClear()
    act(() => handlers['ghl:pipeline:updated']({ caseId: 'c1', moveId: ownMoveId }))
    await new Promise((r) => setTimeout(r, 350))
    expect(api.board).not.toHaveBeenCalled()
    act(() => handlers['ghl:pipeline:updated']({ caseId: 'c2', moveId: 'someone-else' }))
    await waitFor(() => expect(api.board).toHaveBeenCalledTimes(1))
  })

  it('reloads when a case is assigned to this user', async () => {
    await mount()
    api.board.mockClear()
    act(() => handlers['case:assigned']({}))
    await waitFor(() => expect(api.board).toHaveBeenCalledTimes(1))
  })

  it('treats a 503 as "integration not enabled", not an error', async () => {
    api.board.mockRejectedValue({ response: { status: 503 } })
    const hook = renderHook(() => usePipelineBoard())
    await waitFor(() => expect(hook.result.current.status.disabled).toBe(true))
    expect(hook.result.current.status.error).toBeNull()
  })

  it('ignores a move to the column the card is already in', async () => {
    const hook = await mount()
    act(() => hook.result.current.moveCard('c1', 'a'))
    expect(api.moveStage).not.toHaveBeenCalled()
  })

  it('load-more appends only cards it does not already have', async () => {
    api.board.mockResolvedValueOnce({
      data: { configured: true, columns: [{ key: 'a', name: 'A', total: 3, hasMore: true, cards: [card('c1', 'a'), card('c2', 'a')] }, { key: 'b', name: 'B', total: 0, hasMore: false, cards: [] }, { key: 'c', name: 'C', total: 0, hasMore: false, cards: [] }] },
    })
    const hook = await mount()
    api.board.mockResolvedValueOnce({ data: { columns: [{ key: 'a', total: 3, hasMore: false, cards: [card('c2', 'a'), card('c3', 'a')] }] } })
    await act(async () => hook.result.current.loadMore('a'))
    expect(ids(hook, 'a')).toEqual(['c1', 'c2', 'c3'])
    expect(hook.result.current.columns.find((c) => c.key === 'a').hasMore).toBe(false)
  })

  it('asks the server for the chosen pipeline and exposes the tab summary', async () => {
    const hook = await mount('non_immigrant')
    expect(api.board).toHaveBeenCalledWith({ category: 'non_immigrant' })
    expect(hook.result.current.pipelines.map((p) => [p.category, p.total])).toEqual([['immigrant', 2], ['non_immigrant', 5]])
    expect(hook.result.current.activeCategory).toBe('immigrant') // whatever the server says it actually served
  })

  it('switching pipelines clears the old board at once and loads the new one', async () => {
    const hook = renderHook(({ category }) => usePipelineBoard(category), { initialProps: { category: 'immigrant' } })
    await waitFor(() => expect(hook.result.current.columns.length).toBe(3))
    const second = deferred()
    api.board.mockReturnValueOnce(second.promise)
    hook.rerender({ category: 'non_immigrant' })
    expect(hook.result.current.columns).toEqual([]) // no card of the other pipeline can be dragged
    expect(hook.result.current.activeCategory).toBe('non_immigrant') // the tab flips at once, not after the network answer
    expect(api.board).toHaveBeenLastCalledWith({ category: 'non_immigrant' })
    await act(async () => second.resolve({ data: { configured: true, activeCategory: 'non_immigrant', pipelines: [], columns: [{ key: 'x', name: 'X', total: 1, hasMore: false, cards: [card('n1', 'x')] }] } }))
    await waitFor(() => expect(hook.result.current.columns.map((c) => c.key)).toEqual(['x']))
  })

  it('ignores a slow answer for the pipeline the user already switched away from', async () => {
    const slow = deferred()
    api.board.mockReset().mockReturnValueOnce(slow.promise)
    const hook = renderHook(({ category }) => usePipelineBoard(category), { initialProps: { category: 'immigrant' } })
    api.board.mockResolvedValueOnce({ data: { configured: true, activeCategory: 'non_immigrant', pipelines: [], columns: [{ key: 'x', name: 'X', total: 0, hasMore: false, cards: [] }] } })
    hook.rerender({ category: 'non_immigrant' })
    await waitFor(() => expect(hook.result.current.columns.map((c) => c.key)).toEqual(['x']))
    await act(async () => slow.resolve(boardData())) // the old pipeline answers late
    expect(hook.result.current.columns.map((c) => c.key)).toEqual(['x']) // and is ignored
  })

  it('load-more is scoped to the active pipeline', async () => {
    api.board.mockResolvedValueOnce({
      data: { configured: true, activeCategory: 'non_immigrant', pipelines: [], columns: [{ key: 'a', name: 'A', total: 2, hasMore: true, cards: [card('c1', 'a')] }, { key: 'b', name: 'B', total: 0, hasMore: false, cards: [] }, { key: 'c', name: 'C', total: 0, hasMore: false, cards: [] }] },
    })
    const hook = await mount('non_immigrant')
    api.board.mockResolvedValueOnce({ data: { columns: [{ key: 'a', total: 2, hasMore: false, cards: [card('c2', 'a')] }] } })
    await act(async () => hook.result.current.loadMore('a'))
    expect(api.board).toHaveBeenLastCalledWith({ column: 'a', skip: 1, category: 'non_immigrant' })
    expect(ids(hook, 'a')).toEqual(['c1', 'c2'])
  })
})
