import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// The case manager's petition panel: the two release options (attorney review / client review), the status of each petition, the client's latest feedback under the row, and the
// conversation window. The API and socket are faked.
const mocks = vi.hoisted(() => ({
  listUploads: vi.fn(), upload: vi.fn(), list: vi.fn(), sendToAttorney: vi.fn(), sendToClient: vi.fn(), messages: vi.fn(), send: vi.fn(), markRead: vi.fn(), viewLink: vi.fn(), ready: vi.fn(), handlers: {},
}))

vi.mock('../../services/api', () => ({
  documentsApi: { listPetitionUploads: (...a) => mocks.listUploads(...a), uploadPetition: (...a) => mocks.upload(...a), download: vi.fn(), preview: vi.fn() },
  petitionReviewApi: {
    list: (...a) => mocks.list(...a), sendToAttorney: (...a) => mocks.sendToAttorney(...a), sendToClient: (...a) => mocks.sendToClient(...a),
    messages: (...a) => mocks.messages(...a), send: (...a) => mocks.send(...a), markRead: (...a) => mocks.markRead(...a),
    viewLink: (...a) => mocks.viewLink(...a), ready: (...a) => mocks.ready(...a),
    streamUrl: (token, { download } = {}) => `https://api.test/petition-review/stream/${token}${download ? '?download=1' : ''}`,
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ user: { _id: 'u-cm', name: 'Taylor Manager', role: 'case_manager' } }) }))
vi.mock('../../contexts/SocketContext', () => ({
  useOptionalSocket: () => ({ subscribe: (event, handler) => { mocks.handlers[event] = handler; return () => { delete mocks.handlers[event] } } }),
}))

import PetitionUploadPanel from './PetitionUploadPanel'
import { clearViewLinks } from './usePetitionStream'

const doc = (id, name, createdAt = '2026-10-20T10:00:00Z') => ({ _id: id, originalName: name, createdAt })
const message = (id, side, authorName, body) => ({ _id: id, documentId: 'd1', side, authorId: side === 'client' ? 'u-client' : 'u-cm', authorName, body, createdAt: '2026-10-28T15:00:00Z' })
const row = (extra = {}) => ({ documentId: 'd1', fileName: 'Petition.pdf', attorneyReview: null, clientReview: null, messages: { total: 0, unread: 0, latest: [] }, ...extra })
const review = (items, extra = {}) => ({ data: { data: { audience: { role: 'petitioner', name: 'Pat Petitioner' }, attorneys: 1, items, ...extra } } })

beforeEach(() => {
  mocks.listUploads.mockResolvedValue({ data: { documents: [doc('d1', 'Petition.pdf')] } })
  mocks.list.mockResolvedValue(review([row()]))
  mocks.sendToAttorney.mockResolvedValue({ data: { data: { attorneysNotified: 1, emailed: 1 } } })
  mocks.sendToClient.mockResolvedValue({ data: { data: { emailed: true } } })
  mocks.messages.mockResolvedValue({ data: { data: { messages: [message('m1', 'client', 'Pat Petitioner', 'Please fix the spelling of my surname.')], hasMore: false } } })
  mocks.markRead.mockResolvedValue({ data: { data: { ok: true } } })
  mocks.send.mockImplementation((documentId, body, clientMessageId) => Promise.resolve({ data: { data: { message: { ...message('srv-1', 'staff', 'Taylor Manager', body), authorId: 'u-cm', clientMessageId } } } }))
  mocks.viewLink.mockResolvedValue({ data: { data: { token: 'tok' } } })
  mocks.ready.mockResolvedValue({ data: { data: { ready: true } } })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); clearViewLinks(); vi.clearAllMocks(); Object.keys(mocks.handlers).forEach((key) => delete mocks.handlers[key]) })

describe('PetitionUploadPanel', () => {
  it('shows each petition with where it stands and the two ways to send it on', async () => {
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    expect(await screen.findByText('Petition.pdf')).toBeTruthy()
    expect(screen.getByText('Not sent to the attorney')).toBeTruthy()
    expect(screen.getByText('Not sent to the client')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Attorney review/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Client review/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /View/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Download/ })).toBeTruthy()
  })

  it('right after an upload it asks who should review the petition; the choice is sent once, after a confirmation naming the client, and the prompt goes away', async () => {
    mocks.upload.mockImplementation(async () => {
      mocks.listUploads.mockResolvedValue({ data: { documents: [doc('d1', 'Petition.pdf', '2026-10-28T09:00:00Z')] } })
    })
    mocks.listUploads.mockResolvedValueOnce({ data: { documents: [] } })
    mocks.list.mockResolvedValueOnce(review([]))
    const nativeConfirm = vi.spyOn(window, 'confirm').mockImplementation(() => true)
    const { container } = render(<PetitionUploadPanel caseId="c1" canUpload />)
    await screen.findByText('No petition has been uploaded for this case yet.')
    const file = new File(['%PDF'], 'Petition.pdf', { type: 'application/pdf' })
    await act(async () => { fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [file] } }) })
    const banner = await screen.findByRole('status')
    expect(within(banner).getByText(/who should review it/)).toBeTruthy()
    fireEvent.click(within(banner).getByRole('button', { name: /Client review/ }))
    const confirmation = await screen.findByRole('dialog')
    expect(within(confirmation).getByText(/Pat Petitioner \(petitioner\) will be emailed/)).toBeTruthy()
    expect(nativeConfirm).not.toHaveBeenCalled() // the app's own dialog, never the browser's grey popup
    fireEvent.click(within(confirmation).getByRole('button', { name: 'Send to client' }))
    await waitFor(() => expect(mocks.sendToClient).toHaveBeenCalledWith('c1', 'd1'))
    await screen.findByText(/Sent for client review/)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('attorney review: asks first in the app\'s own centred dialog, sends for that petition, reports how many attorneys were told; nothing is sent when the case manager cancels', async () => {
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    fireEvent.click(await screen.findByRole('button', { name: /Attorney review/ }))
    let dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Send for attorney review?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.sendToAttorney).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Attorney review/ }))
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send to attorney' }))
    await waitFor(() => expect(mocks.sendToAttorney).toHaveBeenCalledWith('c1', 'd1'))
    expect(await screen.findByText(/Sent for attorney review - 1 attorney was notified/)).toBeTruthy()
  })

  it('a case with no attorney cannot be sent for attorney review, and a case with no client account cannot be sent for client review', async () => {
    mocks.list.mockResolvedValue(review([row()], { attorneys: 0, audience: null }))
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    const attorney = await screen.findByRole('button', { name: /Attorney review/ })
    const client = screen.getByRole('button', { name: /Client review/ })
    expect(attorney.disabled).toBe(true)
    expect(client.disabled).toBe(true)
    expect(attorney.title).toMatch(/Grant an attorney access/)
  })

  it('a refusal from the server is shown to the case manager', async () => {
    mocks.sendToClient.mockRejectedValue({ response: { data: { message: 'This case has no client account that can receive the petition yet.' } } })
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    fireEvent.click(await screen.findByRole('button', { name: /Client review/ }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Send to client' }))
    expect(await screen.findByText(/no client account that can receive the petition/)).toBeTruthy()
  })

  it('only people who can upload get the release buttons', async () => {
    render(<PetitionUploadPanel caseId="c1" canUpload={false} />)
    await screen.findByText('Petition.pdf')
    expect(screen.queryByRole('button', { name: /Attorney review/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Client review/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Upload Petition/ })).toBeNull()
  })

  it("once released to the client the row shows the client's latest feedback in the same block, with the unread count; it opens into the conversation", async () => {
    mocks.list.mockResolvedValue(review([row({
      attorneyReview: { sentAt: '2026-10-27T10:00:00Z', count: 1 }, clientReview: { sentAt: '2026-10-27T11:00:00Z', count: 1 },
      messages: { total: 9, unread: 2, latest: [message('m1', 'client', 'Pat Petitioner', 'Please fix the spelling of my surname.'), message('m2', 'staff', 'Taylor Manager', 'Done.')] },
    })]))
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    const open = await screen.findByLabelText('Open the feedback conversation for Petition.pdf')
    expect(within(open).getByText('Please fix the spelling of my surname.')).toBeTruthy()
    expect(within(open).getByText('Pat Petitioner')).toBeTruthy()
    expect(within(open).getByText('You')).toBeTruthy()
    expect(within(open).getByText('2 new')).toBeTruthy()
    expect(within(open).getByText(/latest 2 of 9/)).toBeTruthy()
    expect(screen.getByText(/Attorney review sent/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Send to client again/ })).toBeTruthy()

    fireEvent.click(open)
    const dialog = await screen.findByRole('dialog', { name: 'Feedback for Petition.pdf' })
    expect(await within(dialog).findByText('Please fix the spelling of my surname.')).toBeTruthy()
    expect(mocks.markRead).toHaveBeenCalledWith('d1')
  })

  it('the case manager replies in the conversation (Enter sends); the reply goes out once and shows at once', async () => {
    mocks.list.mockResolvedValue(review([row({ clientReview: { sentAt: '2026-10-27T11:00:00Z', count: 1 } })]))
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    fireEvent.click(await screen.findByLabelText('Open the feedback conversation for Petition.pdf'))
    const dialog = await screen.findByRole('dialog')
    const box = await within(dialog).findByPlaceholderText('Reply to the client…')
    fireEvent.change(box, { target: { value: 'I corrected it, please check.' } })
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))
    expect(mocks.send.mock.calls[0][0]).toBe('d1')
    expect(mocks.send.mock.calls[0][1]).toBe('I corrected it, please check.')
    expect((await within(dialog).findAllByText('I corrected it, please check.')).length).toBe(1)
  })

  it("a client's message arriving live refreshes the row and appears in the open conversation", async () => {
    mocks.list.mockResolvedValue(review([row({ clientReview: { sentAt: '2026-10-27T11:00:00Z', count: 1 } })]))
    render(<PetitionUploadPanel caseId="c1" canUpload />)
    fireEvent.click(await screen.findByLabelText('Open the feedback conversation for Petition.pdf'))
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Please fix the spelling of my surname.')
    const callsBefore = mocks.list.mock.calls.length
    await act(async () => { mocks.handlers['petition:message']({ caseId: 'c1', documentId: 'd1', message: message('m-live', 'client', 'Pat Petitioner', 'One more thing: the date of birth.') }) })
    expect(within(dialog).getByText('One more thing: the date of birth.')).toBeTruthy()
    expect(mocks.list.mock.calls.length).toBeGreaterThan(callsBefore)
    await act(async () => { mocks.handlers['petition:message']({ caseId: 'another-case', documentId: 'dz' }) })
    expect(mocks.list.mock.calls.length).toBe(callsBefore + 1)
  })

  describe('full-screen viewer', () => {
    it('View opens the petition over the WHOLE screen; the name, Download and close are inside the PDF box (no header strip of their own); the file is streamed, not downloaded first', async () => {
      render(<PetitionUploadPanel caseId="c1" canUpload />)
      fireEvent.click(await screen.findByRole('button', { name: /View/ }))
      const viewer = await screen.findByRole('dialog', { name: 'Petition: Petition.pdf' })
      expect(viewer.className).toContain('fixed inset-0')
      const frame = await waitFor(() => { const el = within(viewer).getByTitle('petition-preview'); expect(el.getAttribute('src')).toBe('https://api.test/petition-review/stream/tok'); return el })
      expect(frame.className).toContain('h-full w-full')
      expect(frame.parentElement).toBe(viewer)
      const bar = within(viewer).getByRole('button', { name: 'Close the petition' }).parentElement
      expect(bar.parentElement).toBe(viewer)
      expect(bar.className).toContain('absolute')
      expect(within(bar).getByText('Petition.pdf')).toBeTruthy()
      expect(within(bar).getByRole('button', { name: 'Download the petition' })).toBeTruthy()
      expect(mocks.viewLink).toHaveBeenCalledWith('d1')
    })

    it('a petition that takes a while to prepare shows Opening… and keeps trying by itself - no error', async () => {
      const notYet = () => new Promise((resolve) => setTimeout(() => resolve({ data: { data: { ready: false } } }), 250))
      mocks.ready.mockImplementationOnce(notYet).mockImplementationOnce(notYet).mockResolvedValue({ data: { data: { ready: true } } })
      render(<PetitionUploadPanel caseId="c1" canUpload />)
      fireEvent.click(await screen.findByRole('button', { name: /View/ }))
      const viewer = await screen.findByRole('dialog', { name: 'Petition: Petition.pdf' })
      expect(within(viewer).getByText('Opening the petition…')).toBeTruthy()
      expect(await within(viewer).findByText(/keeps trying automatically/)).toBeTruthy()
      await waitFor(() => expect(within(viewer).getByTitle('petition-preview').getAttribute('src')).toContain('/stream/tok'), { timeout: 4000 })
      expect(within(viewer).queryByRole('alert')).toBeNull()
    })

    it('a server hiccup while opening is retried quietly; Escape and the close button leave the viewer', async () => {
      mocks.viewLink.mockRejectedValueOnce({ response: { status: 504, data: { message: 'The server took too long to respond.' } } }).mockResolvedValue({ data: { data: { token: 'tok' } } })
      render(<PetitionUploadPanel caseId="c1" canUpload />)
      fireEvent.click(await screen.findByRole('button', { name: /View/ }))
      const viewer = await screen.findByRole('dialog', { name: 'Petition: Petition.pdf' })
      await waitFor(() => expect(within(viewer).getByTitle('petition-preview').getAttribute('src')).toContain('/stream/tok'), { timeout: 6000 })
      expect(screen.queryByText(/took too long/)).toBeNull()
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      fireEvent.click(screen.getByRole('button', { name: /View/ }))
      fireEvent.click(await screen.findByRole('button', { name: 'Close the petition' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })

    it('a petition that no longer exists says so (and only then)', async () => {
      mocks.viewLink.mockRejectedValue({ response: { status: 404, data: { message: 'This petition was not found.' } } })
      render(<PetitionUploadPanel caseId="c1" canUpload />)
      fireEvent.click(await screen.findByRole('button', { name: /View/ }))
      expect(await screen.findByText('This petition is no longer available.')).toBeTruthy()
    })

    it('hovering View starts preparing the file before the click', async () => {
      render(<PetitionUploadPanel caseId="c1" canUpload />)
      fireEvent.mouseEnter(await screen.findByRole('button', { name: /View/ }))
      await waitFor(() => expect(mocks.ready).toHaveBeenCalled())
    })
  })
})
