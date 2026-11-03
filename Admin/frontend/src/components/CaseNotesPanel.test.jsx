import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'

// plain fakes (not vi.fn spies): each test decides how the API answers; calls are recorded here
const api = { calls: [], reply: async () => ({ data: { success: true } }) }
vi.mock('../services/api', () => ({
  casesApi: {
    addInternalNote: (...args) => { api.calls.push(['add', ...args]); return api.reply('add', ...args) },
    updateInternalNote: (...args) => { api.calls.push(['update', ...args]); return api.reply('update', ...args) },
    deleteInternalNote: (...args) => { api.calls.push(['delete', ...args]); return api.reply('delete', ...args) },
  },
}))
const { default: CaseNotesPanel, creationNoteOf } = await import('./CaseNotesPanel')

const manager = { _id: 'u-cm', role: 'case_manager', name: 'Vasu Sharma' }
const caseWith = (extra = {}) => ({ _id: 'case-1', createdAt: '2026-10-14T10:00:00.000Z', internalNotes: [], ...extra })
const failWith = (message) => async () => { const error = new Error('Request failed'); error.response = { data: { message } }; throw error }
const twoNotes = () => caseWith({
  caseNotes: 'Notes typed at creation',
  internalNotes: [
    { _id: 'n1', note: 'Waiting for payroll documents.', createdAt: '2026-11-02T16:05:00.000Z', author: { _id: 'u-tl', name: 'Anureesh', role: 'team_lead' } },
    { _id: 'n2', note: 'Client confirmed the new address.', createdAt: '2026-11-04T10:42:00.000Z', author: { _id: 'u-cm', name: 'Vasu Sharma', role: 'case_manager' } },
  ],
})

beforeEach(() => { api.calls = []; api.reply = async () => ({ data: { success: true } }) })
afterEach(cleanup)

describe('CaseNotesPanel - notes for the life of the case', () => {
  it('ONE scrollable box (about 6 lines): newest first, writer name / role / time on each, a blank line between notes, creation notes last', () => {
    render(<CaseNotesPanel caseData={twoNotes()} user={manager} />)
    const box = screen.getByTestId('case-notes-list')
    expect(box.style.maxHeight).toBe('9.5rem')
    expect(box.className).toContain('overflow-y-auto')
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0].textContent).toContain('Client confirmed the new address.')
    expect(items[0].textContent).toContain('Vasu Sharma · Case Manager')
    expect(items[1].textContent).toContain('Anureesh · Team Lead')
    expect(items[1].className).toContain('mt-6')
    expect(items[2].textContent).toContain('At case creation')
    expect(items[2].textContent).toContain('Notes typed at creation')
  })

  it('an older case whose first note IS the creation note does not show it twice; a deleted note is not shown', () => {
    const caseData = caseWith({ internalNotes: [
      { _id: 'first', note: 'Created with this note', category: 'general', createdAt: '2026-10-14T10:00:30.000Z', author: { name: 'X' } },
      { _id: 'later', note: 'Later note', createdAt: '2026-10-20T10:00:00.000Z', author: { name: 'Y' } },
      { _id: 'gone', note: 'Deleted note', deletedAt: '2026-10-21T10:00:00.000Z', createdAt: '2026-10-21T09:00:00.000Z', author: { name: 'Z' } },
    ] })
    expect(creationNoteOf(caseData).text).toBe('Created with this note')
    render(<CaseNotesPanel caseData={caseData} user={manager} />)
    expect(screen.getAllByText('Created with this note')).toHaveLength(1)
    expect(screen.queryByText('Deleted note')).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('any internal staff member adds a note; it is saved and the case reloads; an empty note cannot be sent', async () => {
    const onChanged = vi.fn()
    render(<CaseNotesPanel caseData={caseWith()} user={manager} onChanged={onChanged} />)
    const button = screen.getByRole('button', { name: 'Add note' })
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('New note'), { target: { value: '   ' } })
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('New note'), { target: { value: '  Called the employer today.  ' } })
    fireEvent.click(button)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(api.calls).toEqual([['add', 'case-1', { note: 'Called the employer today.' }]])
    expect(screen.getByLabelText('New note').value).toBe('')
    for (const role of ['super_admin', 'admin', 'team_lead']) {
      cleanup()
      render(<CaseNotesPanel caseData={caseWith()} user={{ _id: 'x', role }} />)
      expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy()
    }
  })

  it('a failed save keeps the text in the box and says so', async () => {
    api.reply = failWith('Not authorized to access this case')
    render(<CaseNotesPanel caseData={caseWith()} user={manager} />)
    fireEvent.change(screen.getByLabelText('New note'), { target: { value: 'Important update' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Not authorized')
    expect(screen.getByLabelText('New note').value).toBe('Important update')
  })

  it('only the writer sees Edit on their note; editing saves the new text and reloads; (edited) is shown', async () => {
    const onChanged = vi.fn()
    const caseData = twoNotes()
    caseData.internalNotes[0].editHistory = [{ previousNote: 'old' }]
    render(<CaseNotesPanel caseData={caseData} user={manager} onChanged={onChanged} />)
    const [mine, theirs] = screen.getAllByRole('listitem')
    expect(mine.textContent).toContain('Edit')
    expect(theirs.textContent).not.toContain('Edit')
    expect(theirs.textContent).toContain('(edited)')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Edit note'), { target: { value: 'Client confirmed the new address and phone.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(api.calls).toEqual([['update', 'case-1', 'n2', { note: 'Client confirmed the new address and phone.' }]])
  })

  it('anyone internal can delete a note after confirming in the centred window; Cancel deletes nothing', async () => {
    const onChanged = vi.fn()
    render(<CaseNotesPanel caseData={twoNotes()} user={{ _id: 'u-admin', role: 'admin' }} onChanged={onChanged} />)
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull() // the admin wrote neither note
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('Delete this note?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.calls).toEqual([])
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).find((button) => button.closest('[role="dialog"]')))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(api.calls).toEqual([['delete', 'case-1', 'n1']])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a failed delete keeps the window open with the reason', async () => {
    api.reply = failWith('This note was not found (it may have been deleted).')
    render(<CaseNotesPanel caseData={twoNotes()} user={manager} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' }).find((button) => button.closest('[role="dialog"]')))
    await waitFor(() => expect(screen.getByRole('dialog').textContent).toContain('not found'))
  })

  it('someone who is not internal staff sees no add box and no Edit / Delete; a private note is only shown to its writer', () => {
    const caseData = caseWith({ internalNotes: [{ _id: 'p', note: 'My private reminder', visibility: 'private', createdAt: '2026-11-01T00:00:00.000Z', author: { _id: 'u-other', name: 'Other' } }, { _id: 'q', note: 'Team note', createdAt: '2026-11-01T00:00:00.000Z', author: { _id: 'u-x', name: 'X' } }] })
    render(<CaseNotesPanel caseData={caseData} user={{ _id: 'c', role: 'attorney' }} />)
    expect(screen.queryByRole('button', { name: 'Add note' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByText('My private reminder')).toBeNull()
    cleanup()
    render(<CaseNotesPanel caseData={caseData} user={{ _id: 'u-other', role: 'case_manager' }} />)
    expect(screen.getByText('My private reminder')).toBeTruthy()
  })
})
