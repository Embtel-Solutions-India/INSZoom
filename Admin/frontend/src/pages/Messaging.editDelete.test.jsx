import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// Edit / delete-for-everyone in the Admin Messaging thread. Everything is mocked - no network, no database.
const me = { _id: 'u-me', name: 'Sam Staff', email: 'sam@example.com', role: 'case_manager' }
const now = new Date().toISOString()
const conversation = {
  _id: 'conv1',
  type: 'case',
  caseId: { _id: 'c1', caseNumber: 'CASE-1', clientName: 'Casey Client' },
  clientId: { _id: 'client1', name: 'Casey Client' },
  lastMessageAt: now,
  participants: []
}
const mine = { _id: 'm-mine', message: 'original text', senderId: me._id, caseId: 'c1', conversationId: 'conv1', createdAt: now, readBy: [], attachments: [] }
const theirs = { _id: 'm-their', message: 'from the client', senderId: { _id: 'client1', name: 'Casey Client' }, caseId: 'c1', conversationId: 'conv1', createdAt: now, readBy: [{ userId: me._id }], attachments: [] }
const state = { messages: [] }

const handlers = {}
const apiMock = vi.hoisted(() => ({ get: null, put: null, post: null }))
apiMock.get = vi.fn((url) => {
  if (url === '/messages') return Promise.resolve({ data: { messages: state.messages, conversations: [conversation] } })
  if (url === '/messages/case/c1') return Promise.resolve({ data: { conversation } })
  if (url === '/messages/conv1') return Promise.resolve({ data: { messages: state.messages, hasMore: false } })
  if (url === '/users/assignable') return Promise.resolve({ data: { users: [] } })
  return Promise.resolve({ data: {} })
})
apiMock.put = vi.fn(() => Promise.resolve({ data: {} }))
apiMock.post = vi.fn(() => Promise.resolve({ data: {} }))
const edit = vi.fn()
const deleteForEveryone = vi.fn()
vi.mock('../services/api', () => ({
  default: apiMock,
  messagesApi: { edit: (...a) => edit(...a), deleteForEveryone: (...a) => deleteForEveryone(...a) }
}))
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ user: me }) }))
vi.mock('../contexts/NotificationContext', () => ({ useNotifications: () => ({ fetchUnreadMessageCount: () => {} }) }))
vi.mock('../contexts/SocketContext', () => ({
  useSocket: () => ({
    connected: true,
    subscribe: (event, fn) => { handlers[event] = fn; return () => { delete handlers[event] } }
  })
}))

import Messaging from './Messaging'

const openThread = async () => {
  render(
    <MemoryRouter initialEntries={['/m/c1']}>
      <Routes><Route path="/m/:caseId" element={<Messaging />} /></Routes>
    </MemoryRouter>
  )
  await waitFor(() => expect(screen.getAllByText(/original text|from the client/).length).toBeGreaterThan(0))
}

beforeEach(() => {
  state.messages = [theirs, mine]
  edit.mockReset()
  deleteForEveryone.mockReset()
})
afterEach(() => cleanup())

describe('Messaging edit and delete', () => {
  it('has one three-dots menu per message: Reply and Copy everywhere, Edit/Delete only on your own', async () => {
    await openThread()
    const dots = screen.getAllByLabelText('Message options')
    expect(dots).toHaveLength(2)
    // A plain ellipsis (no chip background/border/shadow, no float) absolutely positioned in the bubble's own right gutter,
    // so short text keeps its single line and the dots never sit on the text.
    expect(dots[0].className).toMatch(/\babsolute\b.*top-1\.5.*right-1\.5/)
    expect(dots[0].className).not.toMatch(/float|border|shadow|bg-/)
    expect(dots[0].parentElement.className).toMatch(/\bpr-7\b/)
    expect(dots[0].parentElement.className).not.toMatch(/\bpx-3\b|float|pt-3|mt-2/)
    expect(dots[0].parentElement.querySelector('[class*=float-right], [class*=clear-both]')).toBeNull()
    fireEvent.click(dots[0])
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Reply', 'Copy'])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(dots[1])
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Reply', 'Copy', 'Edit', 'Delete'])
  })

  it('edits in place, then shows the new text with an Edited label beside the time', async () => {
    edit.mockResolvedValue({ data: { success: true, message: { ...mine, message: 'new text', editedAt: now } } })
    await openThread()
    expect(screen.queryByText('Edited')).toBeNull()
    fireEvent.click(screen.getAllByLabelText('Message options')[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    const box = screen.getByLabelText('Edit message')
    expect(box.value).toBe('original text')
    fireEvent.change(box, { target: { value: '  ' } })
    expect(screen.getByText('Save').disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'new text' } })
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }) })
    expect(edit).toHaveBeenCalledWith('m-mine', 'new text')
    expect(screen.getAllByText('new text').length).toBeGreaterThan(0) // the bubble (and the list preview)
    expect(screen.queryByLabelText('Edit message')).toBeNull()
    expect(screen.getByText('Edited')).toBeTruthy()
  })

  it('keeps the old text and shows the error when the save fails; Esc cancels', async () => {
    edit.mockRejectedValue(Object.assign(new Error('nope'), { response: { data: { message: 'Could not edit' } } }))
    await openThread()
    fireEvent.click(screen.getAllByLabelText('Message options')[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Edit message'), { target: { value: 'changed' } })
    await act(async () => { fireEvent.click(screen.getByText('Save')) })
    expect(screen.getByLabelText('Edit message').value).toBe('changed')
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.keyDown(screen.getByLabelText('Edit message'), { key: 'Escape' })
    expect(screen.getAllByText('original text').length).toBeGreaterThan(0)
  })

  it('deletes for everyone after a confirm popup and leaves the placeholder', async () => {
    deleteForEveryone.mockResolvedValue({ data: { success: true, message: { ...mine, message: '', attachments: [], deletedForEveryoneAt: now } } })
    await openThread()
    fireEvent.click(screen.getAllByLabelText('Message options')[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(screen.getByRole('dialog').textContent).toMatch(/deleted for everyone in this conversation/)
    expect(screen.getByRole('button', { name: 'Delete' }).className).toMatch(/btn-primary/)
    expect(screen.getByRole('button', { name: 'Delete' }).className).not.toMatch(/rose/)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(deleteForEveryone).toHaveBeenCalledWith('m-mine')
    expect(screen.getByTestId('deleted-message').textContent).toMatch(/This message was deleted/)
    expect(screen.queryAllByText('original text')).toHaveLength(0)
    expect(screen.getAllByLabelText('Message options')).toHaveLength(1)
  })

  it("a failed delete leaves 'Working…', shows the error and keeps the message; a retry then succeeds", async () => {
    deleteForEveryone.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { data: { message: 'Could not delete' } } }))
    await openThread()
    fireEvent.click(screen.getAllByLabelText('Message options')[1])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
    expect(screen.queryByText(/Working/)).toBeNull()
    expect(screen.getByRole('dialog').textContent).toMatch(/Could not delete/)
    expect(screen.getAllByText('original text').length).toBeGreaterThan(0)
    deleteForEveryone.mockResolvedValueOnce({ data: { success: true, message: { ...mine, message: '', attachments: [], deletedForEveryoneAt: now } } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete' })) })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('deleted-message')).toBeTruthy()
  })

  it('places the compact menu right-aligned under the dots, clamped to the chat pane, opening upward when short of room', async () => {
    await openThread()
    const original = HTMLElement.prototype.getBoundingClientRect
    const rects = { pane: { left: 300, right: 800, top: 60, bottom: 560 }, button: { left: 740, right: 756, top: 100, bottom: 116 } }
    const asRect = (r) => ({ ...r, x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top })
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.hasAttribute('data-chat-scroll')) return asRect(rects.pane)
      if (this.getAttribute('aria-label') === 'Message options') return asRect(rects.button)
      return original.call(this)
    }
    try {
      fireEvent.click(screen.getAllByLabelText('Message options')[1])
      let menu = screen.getByRole('menu')
      expect(menu.className).toMatch(/\bw-32\b/)
      expect(menu.style.left).toBe('628px') // the dots' right edge (756) - 128: opens toward the left, inside the pane
      expect(menu.style.top).toBe('120px') // 4px below the dots
      fireEvent.keyDown(document, { key: 'Escape' })

      rects.button = { left: 400, right: 416, top: 500, bottom: 516 } // near the pane's bottom edge: opens upward
      fireEvent.click(screen.getAllByLabelText('Message options')[1])
      menu = screen.getByRole('menu')
      expect(menu.style.left).toBe('308px') // clamped to the pane's left edge + 8px inset (416 - 128 would be 288)
      expect(menu.style.top).toBe('360px') // 500 - 4 - (8 + 4 * 32)
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original
    }
  })

  it("the time/ticks row extends into the dots' gutter so it ends under the dots, only on bubbles that have the dots", async () => {
    state.messages = [mine, { ...mine, _id: 'm-gone', deletedForEveryoneAt: now, message: '' }]
    await openThread()
    const [myDots] = screen.getAllByLabelText('Message options')
    const bubble = myDots.parentElement
    expect(bubble.className).toMatch(/\bpr-7\b/); // gutter 28px; dots inset 6px -> the footer pulls 22px back into it
    const footer = bubble.querySelector("[class*='-mr-[22px]']")
    expect(footer).not.toBeNull()
    expect(footer.className).not.toMatch(/\bpr-1\b/)
    // The deleted bubble has no dots and no gutter, so its footer keeps the normal layout.
    const deletedBubble = screen.getByTestId('deleted-message').parentElement
    expect(deletedBubble.className).not.toMatch(/\bpr-7\b/)
    expect(deletedBubble.querySelector("[class*='-mr-[22px]']")).toBeNull()
  })

  it('applies live message:update / message:delete events by _id, idempotently', async () => {
    await openThread()
    const edited = { ...theirs, message: 'client v2', editedAt: now }
    act(() => { handlers['message:update'](edited) })
    act(() => { handlers['message:update'](edited) })
    expect(screen.getAllByText('client v2')).toHaveLength(1)
    expect(screen.getAllByText('Edited')).toHaveLength(1)
    const deleted = { ...theirs, message: '', attachments: [], editedAt: now, deletedForEveryoneAt: now }
    act(() => { handlers['message:delete'](deleted) })
    act(() => { handlers['message:delete'](deleted) })
    expect(screen.queryByText('client v2')).toBeNull()
    expect(screen.queryByText('Edited')).toBeNull()
    expect(screen.getAllByTestId('deleted-message')).toHaveLength(1)
  })
})
