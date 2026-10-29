import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const api = { status: vi.fn(), listFolders: vi.fn(), lookupLinks: vi.fn(), sync: vi.fn(), job: vi.fn(), retry: vi.fn(), createFolder: vi.fn(), connectStart: vi.fn(), disconnect: vi.fn(), validateFolder: vi.fn(), pickerToken: vi.fn() }
vi.mock('../services/api', () => ({ googleDriveApi: new Proxy({}, { get: (_t, name) => (...args) => api[name](...args) }) }))

const docs = [{ _id: 'd1', originalFileName: 'passport.pdf' }, { _id: 'd2', originalFileName: 'degree.pdf' }, { _id: 'd3', originalFileName: 'offer.pdf' }]
const ok = (data) => Promise.resolve({ data })

// The component caches the status for the page session, so each test loads a fresh copy.
async function mount(status) {
  vi.resetModules()
  api.status.mockImplementation(() => (status instanceof Error ? Promise.reject(status) : ok(status)))
  const { default: GoogleDriveExport } = await import('./GoogleDriveExport')
  return render(<GoogleDriveExport caseId="c1" documents={docs} />)
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  api.listFolders.mockReturnValue(ok({ folders: [{ id: 'f1', name: 'Client Files' }], recent: [] }))
  api.lookupLinks.mockReturnValue(ok({ links: { d2: [{ folderName: 'Client Files' }] } }))
  window.history.replaceState({}, '', '/cases/c1')
})

describe('GoogleDriveExport', () => {
  it('renders nothing when the feature is off or the status call fails (existing screen unchanged)', async () => {
    const { container, unmount } = await mount({ success: true, enabled: false })
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(container.firstChild).toBeNull()
    unmount()
    const failed = await mount(new Error('404'))
    await waitFor(() => expect(api.status).toHaveBeenCalled())
    expect(failed.container.firstChild).toBeNull()
  })

  it('every user is asked to connect their OWN Drive (no administrator needed)', async () => {
    await mount({ enabled: true, configured: true, connected: false, status: 'disconnected' })
    fireEvent.click(await screen.findByTestId('add-to-drive-button'))
    expect(await screen.findByText(/Each team member connects their own account/i)).toBeTruthy()
    expect(screen.queryByText(/administrator/i)).toBeNull()
  })

  it('says so when the server is not set up for Drive yet', async () => {
    await mount({ enabled: true, configured: false, connected: false, status: 'disconnected' })
    fireEvent.click(await screen.findByTestId('add-to-drive-button'))
    expect(await screen.findByText(/not fully set up on the server/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Connect my Google Drive/i }).disabled).toBe(true)
  })

  it('lets the user start the connection to their own Google account', async () => {
    api.connectStart.mockReturnValue(ok({ authUrl: '#google-consent' }))
    await mount({ enabled: true, configured: true, connected: false, status: 'disconnected' })
    fireEvent.click(await screen.findByTestId('add-to-drive-button'))
    fireEvent.click(await screen.findByRole('button', { name: /Connect my Google Drive/i }))
    await waitFor(() => expect(api.connectStart).toHaveBeenCalledWith('/cases/c1'))
  })

  it('connected: create a folder, select files, add them, show progress and results', async () => {
    api.createFolder.mockReturnValue(ok({ folder: { id: 'new1', name: 'Case 1' } }))
    api.sync.mockReturnValue(ok({ jobId: 'j1' }))
    api.job.mockReturnValue(ok({ job: { id: 'j1', status: 'completed_with_errors', folderName: 'Case 1', folderLink: 'https://drive.test/f', counts: { synced: 1, updated: 0, skipped: 1, failed: 1 }, items: [
      { documentId: 'd1', name: 'passport.pdf', status: 'synced' },
      { documentId: 'd2', name: 'degree.pdf', status: 'skipped', reason: 'Already in Drive and unchanged.' },
      { documentId: 'd3', name: 'offer.pdf', status: 'failed', reason: 'Google Drive could not be reached. Press Retry to try again.' },
    ] } }))
    await mount({ enabled: true, configured: true, connected: true, status: 'connected', email: 'me@example.com' })
    fireEvent.click(await screen.findByTestId('add-to-drive-button'))
    expect(await screen.findByText('me@example.com')).toBeTruthy()
    expect(await screen.findByText('In Drive')).toBeTruthy() // d2 already has a copy

    const start = screen.getByTestId('drive-start')
    expect(start.disabled).toBe(true) // no folder, no files yet

    fireEvent.change(screen.getByPlaceholderText(/New folder name/i), { target: { value: 'Case 1' } })
    fireEvent.click(screen.getByRole('button', { name: /Create/i }))
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith('Case 1', undefined))
    expect(await screen.findByText('Case 1')).toBeTruthy()

    fireEvent.click(screen.getByLabelText(/Select all/i))
    await waitFor(() => expect(screen.getByTestId('drive-start').textContent).toMatch(/Add 3 files to Drive/))
    fireEvent.click(screen.getByTestId('drive-start'))
    await waitFor(() => expect(api.sync).toHaveBeenCalledWith({ documentIds: ['d1', 'd2', 'd3'], folderId: 'new1', caseId: 'c1' }))

    expect(await screen.findByText('Finished with some problems')).toBeTruthy()
    expect(screen.getByText('Already in Drive and unchanged.')).toBeTruthy()
    expect(screen.getByText(/Press Retry/)).toBeTruthy()
    expect(screen.getByText(/still in Immiglance/i)).toBeTruthy()

    api.retry.mockReturnValue(ok({ job: {} }))
    fireEvent.click(screen.getByRole('button', { name: /Retry failed/i }))
    await waitFor(() => expect(api.retry).toHaveBeenCalledWith('j1'))
  })

  it('reopens with a message after returning from Google, and cleans the URL', async () => {
    window.history.replaceState({}, '', '/cases/c1?gdrive=error&reason=cancelled')
    await mount({ enabled: true, configured: true, connected: false, status: 'disconnected' })
    expect(await screen.findByText(/Google sign-in was cancelled/i)).toBeTruthy()
    expect(window.location.search).toBe('')
  })
})
