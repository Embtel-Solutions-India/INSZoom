import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'

const api = { status: vi.fn(), listFolders: vi.fn(), lookupLinks: vi.fn(), sync: vi.fn(), job: vi.fn(), retry: vi.fn(), createFolder: vi.fn(), connectStart: vi.fn(), activate: vi.fn(), removeAccount: vi.fn(), validateFolder: vi.fn(), pickerToken: vi.fn() }
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
  // The real Admin .env has Picker keys; tests start with none (the no-Picker fallback) unless a suite stubs them in.
  vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', '')
  vi.stubEnv('VITE_GOOGLE_CLOUD_PROJECT_NUMBER', '')
  Object.values(api).forEach((fn) => fn.mockReset())
  api.listFolders.mockReturnValue(ok({ folders: [{ id: 'f1', name: 'Client Files' }], recent: [] }))
  api.lookupLinks.mockReturnValue(ok({ links: { d2: [{ folderName: 'Client Files' }] } }))
  window.history.replaceState({}, '', '/cases/c1')
})

describe('GoogleDriveExport', () => {
  it('the button reads "Add to Drive" with the Google Drive logo to the right of the word', async () => {
    await mount({ enabled: true, configured: true, connected: false, status: 'disconnected' })
    const button = await screen.findByTestId('add-to-drive-button')
    expect(button.textContent.trim()).toBe('Add to Drive')
    const logo = button.querySelector('svg[aria-label="Google Drive"]')
    expect(logo).toBeTruthy()
    expect(logo.previousElementSibling.textContent).toBe('Add to Drive') // logo comes after the text
    expect(logo.querySelectorAll('path').length).toBe(6)
  })

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

  it('without a Picker key: select files, Next, create a folder, add them, show progress and results', async () => {
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

    // Step 1 is documents only; there is no folder UI yet and Next is disabled until something is selected.
    expect(screen.queryByPlaceholderText(/New folder/i)).toBeNull()
    expect(screen.getByTestId('drive-next').disabled).toBe(true)
    fireEvent.click(screen.getByLabelText(/Select all/i))
    await waitFor(() => expect(screen.getByTestId('drive-next').disabled).toBe(false))
    fireEvent.click(screen.getByTestId('drive-next'))

    expect(await screen.findByText(/Step 2 of 2/)).toBeTruthy()
    expect(screen.getByTestId('drive-start').disabled).toBe(true) // no folder yet
    fireEvent.change(screen.getByPlaceholderText(/New folder name/i), { target: { value: 'Case 1' } })
    fireEvent.click(screen.getByRole('button', { name: /Create/i }))
    await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith('Case 1', undefined))
    expect(await screen.findByText('Case 1')).toBeTruthy()
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

  it('a connected user is never asked to connect again; the live state is re-checked on open', async () => {
    await mount({ enabled: true, configured: true, connected: true, status: 'connected', email: 'me@example.com' })
    const callsBefore = api.status.mock.calls.length
    fireEvent.click(await screen.findByTestId('add-to-drive-button'))
    expect(await screen.findByText(/Step 1 of 2/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Connect my Google Drive/i })).toBeNull()
    await waitFor(() => expect(api.status.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('a failed status re-check keeps the connected state and never hides the button', async () => {
    await mount({ enabled: true, configured: true, connected: true, status: 'connected', email: 'me@example.com' })
    api.status.mockImplementation(() => Promise.reject(new Error('network')))
    fireEvent.click(await screen.findByTestId('add-to-drive-button'))
    expect(await screen.findByText(/Step 1 of 2/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Connect my Google Drive/i })).toBeNull()
  })

  it('when Google access was revoked mid-use, the dialog offers Reconnect right away', async () => {
    api.sync.mockImplementation(() => Promise.reject({ response: { data: { code: 'RECONNECT_REQUIRED', message: 'Google Drive access was revoked or expired.' } } }))
    api.createFolder.mockReturnValue(ok({ folder: { id: 'new1', name: 'Case 1' } }))
    await mount({ enabled: true, configured: true, connected: true, status: 'connected', email: 'me@example.com' })
    fireEvent.click(await screen.findByTestId('add-to-drive-button'))
    fireEvent.click(await screen.findByLabelText('passport.pdf'))
    fireEvent.click(screen.getByTestId('drive-next'))
    fireEvent.change(await screen.findByPlaceholderText(/New folder name/i), { target: { value: 'Case 1' } })
    fireEvent.click(screen.getByRole('button', { name: /Create/i }))
    await screen.findByText('Case 1')
    api.status.mockImplementation(() => ok({ enabled: true, configured: true, connected: false, status: 'reconnect_required', email: 'me@example.com' }))
    fireEvent.click(screen.getByTestId('drive-start'))
    expect(await screen.findByRole('button', { name: /Reconnect my Google Drive/i })).toBeTruthy()
  })

  it('Back from the folder step keeps the selection', async () => {
    await mount({ enabled: true, configured: true, connected: true, status: 'connected', email: 'me@example.com' })
    fireEvent.click(await screen.findByTestId('add-to-drive-button'))
    fireEvent.click(await screen.findByLabelText('passport.pdf'))
    fireEvent.click(screen.getByTestId('drive-next'))
    fireEvent.click(await screen.findByTestId('drive-back'))
    expect(await screen.findByText(/Step 1 of 2/)).toBeTruthy()
    expect(screen.getByText(/1 of 3 selected/)).toBeTruthy()
  })

  describe('with Google Picker configured', () => {
    // A stand-in for Google's Picker: records how it was built and lets the test "pick" a folder.
    let built
    const fakePicker = () => {
      built = { views: [], features: [] }
      class DocsView { constructor(id) { built.views.push(this); this.id = id; this.opts = {} } setIncludeFolders(v) { this.opts.includeFolders = v; return this } setSelectFolderEnabled(v) { this.opts.selectFolder = v; return this } setMimeTypes(v) { this.opts.mime = v; return this } setEnableDrives(v) { this.opts.drives = v; return this } }
      class PickerBuilder {
        addView() { return this } enableFeature(f) { built.features.push(f); return this } setOAuthToken(t) { built.token = t; return this } setDeveloperKey(k) { built.key = k; return this } setAppId(a) { built.appId = a; return this }
        setOrigin(o) { built.origin = o; return this } setTitle(t) { built.title = t; return this } setCallback(cb) { built.callback = cb; return this } build() { return { setVisible: (v) => { built.visible = v } } }
      }
      window.google = { picker: { DocsView, PickerBuilder, ViewId: { FOLDERS: 'FOLDERS' }, Feature: { SUPPORT_DRIVES: 'SUPPORT_DRIVES' }, Action: { PICKED: 'picked', CANCEL: 'cancel' } } }
    }
    beforeEach(() => { vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'picker-key'); vi.stubEnv('VITE_GOOGLE_CLOUD_PROJECT_NUMBER', '12345'); fakePicker() })
    afterEach(() => { vi.unstubAllEnvs(); delete window.google })

    it("Next opens Google's own folder browser (no Immiglance folder list); a picked folder is validated and used; a subfolder can be created inside it", async () => {
      api.pickerToken.mockReturnValue(ok({ accessToken: 'short-lived', expiresIn: 1800 }))
      api.validateFolder.mockReturnValue(ok({ folder: { id: 'F9', name: 'Smith / Immigration' } }))
      api.createFolder.mockReturnValue(ok({ folder: { id: 'SUB1', name: 'Evidence' } }))
      api.sync.mockReturnValue(ok({ jobId: 'j2' }))
      api.job.mockReturnValue(ok({ job: { id: 'j2', status: 'completed', folderName: 'Evidence', counts: { synced: 1, updated: 0, skipped: 0, failed: 0 }, items: [{ documentId: 'd1', name: 'passport.pdf', status: 'synced' }] } }))
      await mount({ enabled: true, configured: true, connected: true, status: 'connected', email: 'me@example.com' })
      fireEvent.click(await screen.findByTestId('add-to-drive-button'))
      await screen.findByText('me@example.com')
      expect(api.listFolders).not.toHaveBeenCalled() // the app does not draw its own folder list when Google's is available

      fireEvent.click(await screen.findByLabelText('passport.pdf'))
      expect(built.visible).toBeUndefined() // nothing opens until Next
      fireEvent.click(screen.getByTestId('drive-next'))

      await waitFor(() => expect(built.visible).toBe(true))
      expect(built).toMatchObject({ token: 'short-lived', key: 'picker-key', appId: '12345' })
      expect(built.features).toContain('SUPPORT_DRIVES')
      expect(built.views.length).toBe(2) // My Drive and shared drives
      expect(built.views.every((v) => v.opts.selectFolder === true && v.opts.includeFolders === true)).toBe(true)

      await act(async () => { await built.callback({ action: 'picked', docs: [{ id: 'F9' }] }) })
      await waitFor(() => expect(api.validateFolder).toHaveBeenCalledWith('F9'))
      expect(await screen.findByText('Smith / Immigration')).toBeTruthy()

      // create a new folder INSIDE the folder that was picked
      fireEvent.change(screen.getByPlaceholderText(/New folder inside/i), { target: { value: 'Evidence' } })
      fireEvent.click(screen.getByRole('button', { name: /Create/i }))
      await waitFor(() => expect(api.createFolder).toHaveBeenCalledWith('Evidence', 'F9'))
      fireEvent.click(await screen.findByTestId('drive-start'))
      await waitFor(() => expect(api.sync).toHaveBeenCalledWith({ documentIds: ['d1'], folderId: 'SUB1', caseId: 'c1' }))
    })

    it("cancelling Google's window changes nothing and leaves the dialog usable", async () => {
      api.pickerToken.mockReturnValue(ok({ accessToken: 't', expiresIn: 1800 }))
      await mount({ enabled: true, configured: true, connected: true, status: 'connected', email: 'me@example.com' })
      fireEvent.click(await screen.findByTestId('add-to-drive-button'))
      fireEvent.click(await screen.findByLabelText('passport.pdf'))
      fireEvent.click(screen.getByTestId('drive-next'))
      await waitFor(() => expect(built.visible).toBe(true))
      await act(async () => { await built.callback({ action: 'cancel' }) })
      expect(await screen.findByText(/No folder chosen yet/)).toBeTruthy()
      expect(screen.getByTestId('drive-start').disabled).toBe(true)
      expect(api.validateFolder).not.toHaveBeenCalled()
    })

    it('a folder the user can pick but Immiglance cannot write to shows the reason', async () => {
      api.pickerToken.mockReturnValue(ok({ accessToken: 't', expiresIn: 1800 }))
      api.validateFolder.mockImplementation(() => Promise.reject({ response: { data: { message: 'The connected Google account cannot add files to that folder' } } }))
      await mount({ enabled: true, configured: true, connected: true, status: 'connected', email: 'me@example.com' })
      fireEvent.click(await screen.findByTestId('add-to-drive-button'))
      fireEvent.click(await screen.findByLabelText('passport.pdf'))
      fireEvent.click(screen.getByTestId('drive-next'))
      await waitFor(() => expect(built.visible).toBe(true))
      await act(async () => { await built.callback({ action: 'picked', docs: [{ id: 'RO' }] }) })
      expect(await screen.findByText(/cannot add files to that folder/i)).toBeTruthy()
    })
  })

  describe('several Google accounts', () => {
    const two = { enabled: true, configured: true, connected: true, status: 'connected', email: 'me@work.com', accounts: [
      { id: 'A1', email: 'me@work.com', status: 'connected', active: true },
      { id: 'A2', email: 'personal@gmail.com', status: 'connected', active: false },
    ] }

    it('a small "Add another Drive" button with the Drive logo starts a new connection, without leaving the popup first', async () => {
      api.connectStart.mockReturnValue(ok({ authUrl: '#add-account' }))
      await mount(two)
      fireEvent.click(await screen.findByTestId('add-to-drive-button'))
      const add = await screen.findByTestId('drive-add-account')
      expect(add.textContent).toMatch(/Add another Drive/)
      expect(add.querySelector('svg[aria-label="Google Drive"]')).toBeTruthy()
      fireEvent.click(add)
      await waitFor(() => expect(api.connectStart).toHaveBeenCalledWith('/cases/c1'))
    })

    it('lists the accounts, marks the active one, and switching sends the user back to step 1 on the new account', async () => {
      const switched = { ...two, email: 'personal@gmail.com', accounts: [{ id: 'A1', email: 'me@work.com', status: 'connected', active: false }, { id: 'A2', email: 'personal@gmail.com', status: 'connected', active: true }] }
      api.activate.mockReturnValue(ok(switched))
      await mount(two)
      fireEvent.click(await screen.findByTestId('add-to-drive-button'))
      expect(await screen.findByText(/2 accounts, switch/)).toBeTruthy()
      fireEvent.click(screen.getByLabelText('passport.pdf')) // a selection made on the first account...
      fireEvent.click(screen.getByTestId('drive-accounts-toggle'))
      const list = await screen.findByTestId('drive-accounts')
      expect(list.textContent).toMatch(/me@work\.com.*Active/s)
      expect(list.textContent).toMatch(/personal@gmail\.com/)
      fireEvent.click(screen.getByRole('button', { name: 'Use this Drive' }))
      await waitFor(() => expect(api.activate).toHaveBeenCalledWith('A2'))
      expect(await screen.findByText(/Now using personal@gmail\.com/)).toBeTruthy()
      expect(screen.getByTestId('drive-next').disabled).toBe(true) // ...is cleared, the folder belongs to the previous account
      expect(screen.getByText('personal@gmail.com', { selector: 'strong' })).toBeTruthy()
    })

    it('removing an account asks first, and removing the last one returns to the connect screen', async () => {
      const one = { ...two, accounts: [two.accounts[0]] }
      api.removeAccount.mockReturnValue(ok({ enabled: true, configured: true, connected: false, status: 'disconnected', email: null, accounts: [] }))
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
      await mount(one)
      fireEvent.click(await screen.findByTestId('add-to-drive-button'))
      fireEvent.click(await screen.findByTestId('drive-accounts-toggle'))
      fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
      expect(api.removeAccount).not.toHaveBeenCalled() // cancelled
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
      await waitFor(() => expect(api.removeAccount).toHaveBeenCalledWith('A1'))
      expect(await screen.findByRole('button', { name: /Connect my Google Drive/i })).toBeTruthy()
      confirm.mockRestore()
    })

    it('an expired account is flagged and can be reconnected, while another account can still be used', async () => {
      await mount({ enabled: true, configured: true, connected: false, status: 'reconnect_required', email: 'me@work.com', accounts: [
        { id: 'A1', email: 'me@work.com', status: 'reconnect_required', active: true },
        { id: 'A2', email: 'personal@gmail.com', status: 'connected', active: false },
      ] })
      fireEvent.click(await screen.findByTestId('add-to-drive-button'))
      expect(await screen.findByText(/Needs reconnect/)).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Reconnect' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Use this Drive' })).toBeTruthy()
    })

    it('a single connected account is never asked to connect again and shows no switching noise', async () => {
      await mount({ ...two, accounts: [two.accounts[0]] })
      fireEvent.click(await screen.findByTestId('add-to-drive-button'))
      expect(await screen.findByText(/Step 1 of 2/)).toBeTruthy()
      expect(screen.queryByText(/accounts, switch/)).toBeNull()
      expect(screen.queryByTestId('drive-accounts')).toBeNull()
    })
  })

  it('reopens with a message after returning from Google, and cleans the URL', async () => {
    window.history.replaceState({}, '', '/cases/c1?gdrive=error&reason=cancelled')
    await mount({ enabled: true, configured: true, connected: false, status: 'disconnected' })
    expect(await screen.findByText(/Google sign-in was cancelled/i)).toBeTruthy()
    expect(window.location.search).toBe('')
  })
})
