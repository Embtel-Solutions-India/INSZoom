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
  connected: true,
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
    connected: mocks.connected,
    // like the real context: a no-op until the socket exists
    subscribe: (event, handler) => {
      if (!mocks.connected) return () => {}
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
  mocks.connected = true
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
  it('shows the three-dots menu on every live message, with Edit / Delete only on the user own messages', async () => {
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Original text')
    expect(screen.getAllByLabelText('Message options')).toHaveLength(2)
    openMenuFor('Their text')
    expect(screen.getByRole('menuitem', { name: /Reply/ })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: /Edit/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    openMenuFor('Original text')
    expect(screen.getByRole('menuitem', { name: /Edit/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy()
  })

  it('Reply from the menu starts a reply to that message (same as the standalone Reply button)', async () => {
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Their text')
    openMenuFor('Their text')
    fireEvent.click(screen.getByRole('menuitem', { name: /Reply/ }))
    expect(screen.getByText(/Replying to/)).toBeTruthy()
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
    const box = screen.getByLabelText('Edit message')
    fireEvent.change(box, { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true)
    fireEvent.change(box, { target: { value: 'Something else' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Nope')).toBeTruthy()
    expect(screen.getByLabelText('Edit message')).toBeTruthy()
    fireEvent.keyDown(screen.getByLabelText('Edit message'), { key: 'Escape' })
    expect(screen.queryByLabelText('Edit message')).toBeNull()
    expect(screen.getByText('Original text')).toBeTruthy()

  })

  it('confirms, deletes for everyone and leaves the "This message was deleted" placeholder in place', async () => {
    mocks.del.mockResolvedValue({ data: { success: true, feedback: msg({ message: '', attachments: [], deletedForEveryoneAt: '2026-10-20T10:06:00Z' }) } })
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Original text')
    openMenuFor('Original text')
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }))
    expect(screen.getByText(/deleted for everyone in this conversation/)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    await screen.findByText('This message was deleted')
    expect(mocks.del).toHaveBeenCalledWith('/cases/case-1/feedback/m1')
    expect(screen.queryByText('Original text')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getAllByLabelText('Message options')).toHaveLength(1)
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

  it('re-subscribes when the socket connects late, and accepts a populated caseId on events', async () => {
    mocks.connected = false
    const { rerender } = render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Their text')
    expect(mocks.handlers['feedback:update']).toBeUndefined()
    mocks.connected = true
    rerender(<CaseFeedbackChat caseId="case-1" />)
    expect(mocks.handlers['feedback:update']).toBeTypeOf('function')
    expect(mocks.handlers['feedback:delete']).toBeTypeOf('function')
    act(() => { mocks.handlers['feedback:update'](msg({ _id: 'm2', caseId: { _id: 'case-1' }, authorId: attorney, message: 'Edited remotely', editedAt: '2026-10-20T10:09:00Z', createdAt: '2026-10-20T10:01:00Z' })) })
    expect(screen.getByText('Edited remotely')).toBeTruthy()
  })

  it('shows the confirm popup in the primary (non-danger) style, and clears Working... when the delete fails', async () => {
    mocks.del.mockRejectedValue({ response: { data: { message: 'Server said no' } } })
    render(<CaseFeedbackChat caseId="case-1" />)
    await screen.findByText('Original text')
    openMenuFor('Original text')
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Delete message?')).toBeTruthy()
    const confirm = within(dialog).getByRole('button', { name: 'Delete' })
    expect(confirm.className).toContain('btn-primary')
    expect(confirm.className).not.toContain('rose')
    fireEvent.click(confirm)
    expect(await within(dialog).findByText('Server said no')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Delete' }).disabled).toBe(false)
    expect(screen.getByText('Original text')).toBeTruthy()
  })

  it('renders the three-dots control as a plain absolute icon in a right gutter (no float, no chip)', async () => {
    render(<CaseFeedbackChat caseId="case-1" />)
    const text = await screen.findByText('Original text')
    const bubble = text.parentElement
    const button = within(bubble).getByLabelText('Message options')
    expect(button.className).toContain('absolute')
    expect(button.className).toContain('top-1.5')
    expect(button.className).not.toMatch(/(float-|border|shadow|bg-)/)
    expect(bubble.className).toContain('relative')
    expect(bubble.className).toContain('pr-7')
    // time / ticks row ends directly below the dots: it cancels the 28px gutter minus the dots' 6px inset
    const footer = bubble.querySelector('div[class*="justify-end"]')
    expect(footer.className).toContain('-mr-[22px]')
    expect(footer.className).toContain('pr-0')
    expect(footer.className).not.toContain('-mr-4')
    expect(bubble.className).not.toContain('pt-3')
    // a bubble without the control (the deleted placeholder's neighbours aside) keeps the normal padding
    expect(within(screen.getByText('Their text').parentElement).getByLabelText('Message options').closest('div').className).toContain('pr-7')
  })

  describe('menu placement', () => {
    const rectOf = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} })
    let spy
    const setup = async (button) => {
      spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
        if (this.getAttribute?.('role') === 'menu') return rectOf(0, 0, 128, 100)
        if (this.getAttribute?.('aria-label') === 'Message options' && this.closest('.group')?.textContent.includes('Original text')) return button
        if (this.hasAttribute?.('data-chat-scroll')) return rectOf(0, 0, 400, 600) // 15px of that is the scrollbar
        return rectOf(0, 0, 0, 0)
      })
      render(<CaseFeedbackChat caseId="case-1" />)
      await screen.findByText('Original text')
      const pane = document.querySelector('[data-chat-scroll]')
      Object.defineProperty(pane, 'clientWidth', { configurable: true, value: 385 })
      Object.defineProperty(pane, 'clientHeight', { configurable: true, value: 600 })
      openMenuFor('Original text')
      return screen.getByRole('menu')
    }
    afterEach(() => spy?.mockRestore())

    it('aligns its right edge with the dots, 4px below, clamped inside the pane (never over the scrollbar)', async () => {
      const menu = await setup(rectOf(364, 80, 16, 16))
      expect(menu.style.top).toBe('100px') // 96 + 4
      expect(menu.style.left).toBe('249px') // pane inner right 385 - 8 inset - 128 wide (the dots' right edge 380 would poke past it)
      expect(menu.className).toContain('w-32')
    })

    it('opens upward when there is no room below inside the pane', async () => {
      const menu = await setup(rectOf(200, 560, 16, 16))
      expect(menu.style.top).toBe('456px') // 560 - 4 - 100
      expect(menu.style.left).toBe('88px') // 216 - 128
    })
  })

  it('keeps the deleted placeholder in the same gutter so its time lines up under where the dots would be', async () => {
    mocks.list.mockResolvedValue({ data: { feedback: [msg({ message: '', deletedForEveryoneAt: '2026-10-20T10:06:00Z' })] } })
    render(<CaseFeedbackChat caseId="case-1" />)
    const bubble = (await screen.findByText('This message was deleted')).parentElement
    expect(bubble.className).toContain('pr-7')
    expect(bubble.querySelector('div[class*="justify-end"]').className).toContain('-mr-[22px]')
    expect(within(bubble).queryByLabelText('Message options')).toBeNull()
  })
})
