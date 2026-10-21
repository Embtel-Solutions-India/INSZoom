import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

afterEach(() => { cleanup() })

// Edit-in-place / delete-for-everyone on the attorney <-> staff feedback thread. The API and socket are faked.
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  markRead: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  handlers: {},
}))

vi.mock('../services/api', () => ({
  default: { patch: (...a) => mocks.patch(...a), delete: (...a) => mocks.del(...a), get: vi.fn(), post: vi.fn() },
  feedbackApi: {
    list: (...a) => mocks.list(...a),
    markRead: (...a) => mocks.markRead(...a),
    send: vi.fn(),
    reply: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: { _id: 'me', name: 'Case Manager', role: 'case_manager' } }) }))
vi.mock('../contexts/SocketContext', () => ({
  useSocket: () => ({
    subscribe: (event, handler) => {
      mocks.handlers[event] = handler
      return () => { delete mocks.handlers[event] }
    },
  }),
}))

import CaseFeedbackChat from './CaseFeedbackChat'

const me = { _id: 'me', name: 'Case Manager', role: 'case_manager' }
const attorney = { _id: 'att', name: 'Alex Attorney', role: 'attorney' }
const msg = (over) => ({ _id: 'm1', caseId: 'case-1', authorId: me, message: 'Original text', createdAt: '2026-10-20T10:00:00Z', readBy: [], attachments: [], ...over })

beforeEach(() => {
  mocks.handlers = {}
  mocks.markRead.mockReset().mockResolvedValue({})
  mocks.patch.mockReset()
  mocks.del.mockReset()
  mocks.list.mockReset().mockResolvedValue({
    data: { feedback: [msg({}), msg({ _id: 'm2', authorId: attorney, message: 'Their text', createdAt: '2026-10-20T10:01:00Z' })] },
  })
  Element.prototype.scrollTo = vi.fn()
})

const openMenuFor = (text) => {
  const bubble = screen.getByText(text).closest('.group')
  fireEvent.click(within(bubble).getByLabelText('Message options'))
}

describe('CaseFeedbackChat edit / delete', () => {
  it('offers the menu only on the signed-in user\'s own messages', async () => {
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Original text')
    expect(screen.getAllByLabelText('Message options')).toHaveLength(1)
    expect(within(screen.getByText('Their text').closest('.group')).queryByLabelText('Message options')).toBeNull()
  })

  it('edits in place, saves with Enter, and shows the Edited label beside the time', async () => {
    mocks.patch.mockResolvedValue({ data: { success: true, feedback: msg({ message: 'Fixed text', editedAt: '2026-10-20T10:05:00Z' }) } })
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Original text')
    expect(screen.queryByText('Edited')).toBeNull()

    openMenuFor('Original text')
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit/ }))
    const box = screen.getByLabelText('Edit message')
    expect(box.value).toBe('Original text')
    fireEvent.change(box, { target: { value: 'Fixed text' } })
    fireEvent.keyDown(box, { key: 'Enter' })

    await screen.findByText('Fixed text')
    expect(mocks.patch).toHaveBeenCalledWith('/cases/case-1/feedback/m1', { message: 'Fixed text' })
    expect(screen.getByText('Edited')).toBeTruthy()
    expect(screen.queryByLabelText('Edit message')).toBeNull()
  })

  it('cancels with Escape, refuses empty text, and keeps the old text when the request fails', async () => {
    mocks.patch.mockRejectedValue({ response: { data: { message: 'Nope' } } })
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Original text')
    openMenuFor('Original text')
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit/ }))
    let box = screen.getByLabelText('Edit message')
    fireEvent.change(box, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'Something else' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Nope')).toBeTruthy()
    expect(screen.getByLabelText('Edit message')).toBeTruthy()
    fireEvent.keyDown(screen.getByLabelText('Edit message'), { key: 'Escape' })
    expect(screen.queryByLabelText('Edit message')).toBeNull()
    expect(screen.getByText('Original text')).toBeTruthy()
    box = null
  })

  it('confirms, deletes for everyone and leaves the "This message was deleted" placeholder in place', async () => {
    mocks.del.mockResolvedValue({ data: { success: true, feedback: msg({ message: '', attachments: [], deletedForEveryoneAt: '2026-10-20T10:06:00Z' }) } })
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Original text')
    openMenuFor('Original text')
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }))
    expect(screen.getByText(/removed for everyone in this conversation/)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await screen.findByText('This message was deleted')
    expect(mocks.del).toHaveBeenCalledWith('/cases/case-1/feedback/m1')
    expect(screen.queryByText('Original text')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('Message options')).toBeNull()
    expect(screen.getByText('Their text')).toBeTruthy()
  })

  it('applies feedback:update and feedback:delete events by replacing the message (never appending)', async () => {
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Their text')
    expect(mocks.handlers['feedback:update']).toBeTypeOf('function')
    expect(mocks.handlers['feedback:delete']).toBeTypeOf('function')

    const edited = msg({ _id: 'm2', authorId: attorney, message: 'Their NEW text', editedAt: '2026-10-20T10:07:00Z', createdAt: '2026-10-20T10:01:00Z' })
    act(() => { mocks.handlers['feedback:update'](edited) })
    act(() => { mocks.handlers['feedback:update'](edited) }) // idempotent
    expect(screen.getByText('Their NEW text')).toBeTruthy()
    expect(screen.queryByText('Their text')).toBeNull()
    expect(screen.getAllByText('Edited')).toHaveLength(1)
    expect(screen.getAllByText(/Original text|Their NEW text/)).toHaveLength(2)

    act(() => { mocks.handlers['feedback:delete'](msg({ _id: 'm2', authorId: attorney, message: '', editedAt: '2026-10-20T10:07:00Z', deletedForEveryoneAt: '2026-10-20T10:08:00Z', createdAt: '2026-10-20T10:01:00Z' })) })
    expect(screen.getByText('This message was deleted')).toBeTruthy()
    expect(screen.queryByText('Edited')).toBeNull()
    // events for another case are ignored, and none of this touches read state
    act(() => { mocks.handlers['feedback:update'](msg({ _id: 'm1', caseId: 'other', message: 'hijack' })) })
    expect(screen.queryByText('hijack')).toBeNull()
    expect(mocks.markRead).toHaveBeenCalledTimes(1)
  })

  it('renders a reply quote pointing at a deleted message as the deleted placeholder', async () => {
    mocks.list.mockResolvedValue({
      data: {
        feedback: [
          msg({ _id: 'p', authorId: attorney, message: '', deletedForEveryoneAt: '2026-10-20T10:02:00Z' }),
          msg({ _id: 'r', message: 'Reply body', parentFeedbackId: 'p', createdAt: '2026-10-20T10:03:00Z' }),
        ],
      },
    })
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Reply body')
    await waitFor(() => expect(screen.getAllByText('This message was deleted')).toHaveLength(2))
  })
})
