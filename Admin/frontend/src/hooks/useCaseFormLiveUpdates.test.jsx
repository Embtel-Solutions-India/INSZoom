import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'

// Live updates for an open form: only OTHER people's changes to THIS form trigger one refresh; with no socket it is a harmless no-op. Socket and auth are faked.
let socketContext = null
let authContext = { user: { _id: 'me' } }
vi.mock('../contexts/SocketContext', () => ({ useOptionalSocket: () => socketContext }))
vi.mock('../contexts/AuthContext', () => ({ useOptionalAuth: () => authContext }))

import { useCaseFormLiveUpdates, LIVE_EVENT, LIVE_DEBOUNCE_MS } from './useCaseFormLiveUpdates'

const makeSocket = () => {
  const handlers = {}
  return {
    handlers,
    emit: vi.fn(),
    on: vi.fn((event, handler) => { handlers[event] = handler }),
    off: vi.fn((event) => { delete handlers[event] }),
  }
}

function Probe({ onRemoteChange, caseFormId = 'f1' }) {
  useCaseFormLiveUpdates({ caseId: 'c1', caseFormId, onRemoteChange })
  return null
}

beforeEach(() => { vi.useFakeTimers(); authContext = { user: { _id: 'me' } } })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useCaseFormLiveUpdates', () => {
  it('does nothing, and does not throw, without a socket provider or when not connected', () => {
    const cb = vi.fn()
    socketContext = null
    expect(() => render(<Probe onRemoteChange={cb} />)).not.toThrow()
    cleanup()
    socketContext = { socket: makeSocket(), connected: false }
    render(<Probe onRemoteChange={cb} />)
    expect(socketContext.socket.emit).not.toHaveBeenCalled()
    expect(cb).not.toHaveBeenCalled()
  })

  it('joins the form room when connected and leaves it when the screen closes', () => {
    const socket = makeSocket()
    socketContext = { socket, connected: true }
    const { unmount } = render(<Probe onRemoteChange={vi.fn()} />)
    expect(socket.emit).toHaveBeenCalledWith('caseForm:join', { caseId: 'c1', caseFormId: 'f1' }, expect.any(Function))
    unmount()
    expect(socket.emit).toHaveBeenCalledWith('caseForm:leave', { caseFormId: 'f1' })
    expect(socket.off).toHaveBeenCalledWith(LIVE_EVENT, expect.any(Function))
  })

  it("someone else's change to this form triggers ONE refresh, even for a burst of saves", () => {
    const socket = makeSocket()
    socketContext = { socket, connected: true }
    const cb = vi.fn()
    render(<Probe onRemoteChange={cb} />)
    const send = (event) => act(() => { socket.handlers[LIVE_EVENT](event) })
    send({ caseFormId: 'f1', actorId: 'raj', actorName: 'Raj Patel' })
    send({ caseFormId: 'f1', actorId: 'raj', actorName: 'Raj Patel' })
    send({ caseFormId: 'f1', actorId: 'asha', actorName: 'Asha Rao' })
    expect(cb).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(LIVE_DEBOUNCE_MS + 10) })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].actorName).toBe('Asha Rao')
  })

  it('ignores my own saves and changes to other forms', () => {
    const socket = makeSocket()
    socketContext = { socket, connected: true }
    const cb = vi.fn()
    render(<Probe onRemoteChange={cb} />)
    act(() => { socket.handlers[LIVE_EVENT]({ caseFormId: 'f1', actorId: 'me' }) })
    act(() => { socket.handlers[LIVE_EVENT]({ caseFormId: 'other', actorId: 'raj' }) })
    act(() => { vi.advanceTimersByTime(2000) })
    expect(cb).not.toHaveBeenCalled()
  })

  it('a refresh that throws never breaks anything', () => {
    const socket = makeSocket()
    socketContext = { socket, connected: true }
    render(<Probe onRemoteChange={() => { throw new Error('boom') }} />)
    act(() => { socket.handlers[LIVE_EVENT]({ caseFormId: 'f1', actorId: 'raj' }) })
    expect(() => act(() => { vi.advanceTimersByTime(1000) })).not.toThrow()
  })

  it('refreshes once after the connection comes back, to catch what was missed', () => {
    const socket = makeSocket()
    socketContext = { socket, connected: true }
    const cb = vi.fn()
    const { rerender } = render(<Probe onRemoteChange={cb} />)
    socketContext = { socket, connected: false }
    rerender(<Probe onRemoteChange={cb} />)
    socketContext = { socket, connected: true }
    rerender(<Probe onRemoteChange={cb} />)
    act(() => { vi.advanceTimersByTime(LIVE_DEBOUNCE_MS + 10) })
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb.mock.calls[0][0].reconnect).toBe(true)
  })
})
