import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within, configure } from '@testing-library/react'

// Folder discovery in the in-app browser: My Drive, Shared with me, Shared drives, search, "Load more", view-only folders and clear errors.
// Google itself is replaced by the mocked API below, so this checks what the screen asks for and shows, not Google's side.
configure({ asyncUtilTimeout: 10000 })
vi.setConfig({ testTimeout: 30000 })

const api = { status: vi.fn(), listFolders: vi.fn(), lookupLinks: vi.fn(), sync: vi.fn(), job: vi.fn(), retry: vi.fn(), createFolder: vi.fn(), connectStart: vi.fn(), activate: vi.fn(), removeAccount: vi.fn(), validateFolder: vi.fn(), pickerToken: vi.fn() }
vi.mock('../services/api', () => ({ googleDriveApi: new Proxy({}, { get: (_t, name) => (...args) => api[name](...args) }) }))

const docs = [{ _id: 'd1', originalFileName: 'passport.pdf' }]
const ok = (data) => Promise.resolve({ data })
const connected = { enabled: true, configured: true, connected: true, status: 'connected', email: 'accountb@example.com' }

async function openBrowser() {
  vi.resetModules()
  api.status.mockImplementation(() => ok(connected))
  const { default: GoogleDriveExport } = await import('./GoogleDriveExport')
  render(<GoogleDriveExport caseId="c1" documents={docs} />)
  fireEvent.click(await screen.findByTestId('add-to-drive-button'))
  fireEvent.click(await screen.findByLabelText('passport.pdf'))
  fireEvent.click(screen.getByTestId('drive-next'))
  return screen.findByTestId('drive-browser')
}

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', '')
  vi.stubEnv('VITE_GOOGLE_CLOUD_PROJECT_NUMBER', '')
  Object.values(api).forEach((fn) => fn.mockReset())
  api.lookupLinks.mockReturnValue(ok({ links: {} }))
  api.listFolders.mockReturnValue(ok({ folders: [], nextPageToken: null, recent: [] }))
  window.history.replaceState({}, '', '/cases/c1')
})

describe('folder browser: finding every folder the account can reach', () => {
  it('shows My Drive, Shared with me and Shared drives as tabs and starts on My Drive', async () => {
    api.listFolders.mockReturnValue(ok({ folders: [{ id: 'mine', name: 'Owned by me', canAddChildren: true }], recent: [] }))
    const browser = await openBrowser()
    expect(within(browser).getByTestId('drive-tab-mine').getAttribute('aria-pressed')).toBe('true')
    expect(within(browser).getByTestId('drive-tab-shared')).toBeTruthy()
    expect(within(browser).getByTestId('drive-tab-drives')).toBeTruthy()
    expect(await screen.findByText('Owned by me')).toBeTruthy()
    expect(api.listFolders).toHaveBeenCalledWith('root') // plain browsing asks exactly as before
  })

  it('Shared with me lists folders other people shared, says who shared them, and opens their subfolders', async () => {
    api.listFolders.mockImplementation((parent, options) => {
      if (options?.view === 'shared') return ok({ folders: [{ id: 's1', name: 'Client X Files', owner: 'Account A', shared: true, canAddChildren: true }], nextPageToken: null })
      if (parent === 's1') return ok({ folders: [{ id: 's2', name: 'Nested petitions', canAddChildren: true }], nextPageToken: null })
      return ok({ folders: [], nextPageToken: null, recent: [] })
    })
    const browser = await openBrowser()
    fireEvent.click(within(browser).getByTestId('drive-tab-shared'))
    expect(await screen.findByText('Client X Files')).toBeTruthy()
    expect(screen.getByText(/Shared by Account A/)).toBeTruthy()
    expect(api.listFolders).toHaveBeenCalledWith(null, { view: 'shared' })

    fireEvent.click(screen.getByText('Client X Files')) // into the shared folder
    expect(await screen.findByText('Nested petitions')).toBeTruthy() // a nested shared folder
    expect(api.listFolders).toHaveBeenCalledWith('s1')
    expect(browser.textContent).toMatch(/Shared with me.*\/.*Client X Files/s)
  })

  it('Shared drives lists the drives the account belongs to and opens one', async () => {
    api.listFolders.mockImplementation((parent, options) => {
      if (options?.view === 'drives') return ok({ folders: [{ id: 'drv1', name: 'Firm Drive', isSharedDrive: true, canAddChildren: true }], nextPageToken: null })
      if (parent === 'drv1') return ok({ folders: [{ id: 'in1', name: 'Matters', canAddChildren: true }], nextPageToken: null })
      return ok({ folders: [], nextPageToken: null, recent: [] })
    })
    const browser = await openBrowser()
    fireEvent.click(within(browser).getByTestId('drive-tab-drives'))
    expect(await screen.findByText('Firm Drive')).toBeTruthy()
    expect(screen.getByText('Shared drive')).toBeTruthy()
    fireEvent.click(screen.getByText('Firm Drive'))
    expect(await screen.findByText('Matters')).toBeTruthy()
    expect(api.listFolders).toHaveBeenCalledWith('drv1')
  })

  it('explains an empty Shared with me instead of showing a blank box', async () => {
    const browser = await openBrowser()
    fireEvent.click(within(browser).getByTestId('drive-tab-shared'))
    expect(await screen.findByText(/No folders have been shared with this Google account/)).toBeTruthy()
  })

  it('a connection without full Drive access gets the plain explanation from the server', async () => {
    api.listFolders.mockImplementation((_parent, options) => (options?.view
      ? Promise.reject({ response: { data: { code: 'SCOPE_LIMITED', message: 'Shared folders and search need full Google Drive access. Use Google\'s own folder window.' } } })
      : ok({ folders: [], recent: [] })))
    const browser = await openBrowser()
    fireEvent.click(within(browser).getByTestId('drive-tab-shared'))
    expect(await screen.findByText(/need full Google Drive access/)).toBeTruthy()
  })
})

describe('folder browser: search', () => {
  it('searches by name across the whole Drive once two letters are typed, and ignores a single letter', async () => {
    api.listFolders.mockImplementation((_parent, options) => (options?.q === 'smi'
      ? ok({ folders: [{ id: 'x1', name: 'Smith Family', owner: 'Account A', canAddChildren: true }, { id: 'x2', name: 'Smithson Co', isSharedDrive: true, canAddChildren: true }], nextPageToken: null })
      : ok({ folders: [{ id: 'mine', name: 'Owned by me', canAddChildren: true }], recent: [] })))
    const browser = await openBrowser()
    await screen.findByText('Owned by me')
    const search = within(browser).getByTestId('drive-search')

    fireEvent.change(search, { target: { value: 's' } })
    await new Promise((resolve) => setTimeout(resolve, 600))
    expect(api.listFolders.mock.calls.some(([, options]) => options?.q)).toBe(false) // one letter does not search

    fireEvent.change(search, { target: { value: 'smi' } })
    expect(await screen.findByText('Smith Family')).toBeTruthy()
    expect(screen.getByText('Smithson Co')).toBeTruthy()
    expect(screen.getByText(/Shared by Account A/)).toBeTruthy()
    expect(api.listFolders).toHaveBeenCalledWith(null, { q: 'smi' })
    expect(browser.textContent).toMatch(/Search “smi”/)
    expect(screen.queryByRole('button', { name: /Use “/ })).toBeNull() // search results are a list, not a place to "use"
  })

  it('says when nothing matches, and clearing the search returns to the folders', async () => {
    api.listFolders.mockImplementation((_parent, options) => (options?.q ? ok({ folders: [], nextPageToken: null }) : ok({ folders: [{ id: 'mine', name: 'Owned by me', canAddChildren: true }], recent: [] })))
    const browser = await openBrowser()
    await screen.findByText('Owned by me')
    fireEvent.change(within(browser).getByTestId('drive-search'), { target: { value: 'zzz' } })
    expect(await screen.findByText(/No folders match “zzz”/)).toBeTruthy()
    fireEvent.change(within(browser).getByTestId('drive-search'), { target: { value: '' } })
    await waitFor(() => expect(screen.getByText('Owned by me')).toBeTruthy())
  })

  it('a search result opens like any folder and can be chosen as the destination', async () => {
    api.validateFolder.mockReturnValue(ok({ folder: { id: 'x1', name: 'Smith Family' } }))
    api.listFolders.mockImplementation((parent, options) => {
      if (options?.q) return ok({ folders: [{ id: 'x1', name: 'Smith Family', canAddChildren: true }], nextPageToken: null })
      if (parent === 'x1') return ok({ folders: [{ id: 'x3', name: 'Evidence', canAddChildren: true }], nextPageToken: null })
      return ok({ folders: [], recent: [] })
    })
    const browser = await openBrowser()
    fireEvent.change(within(browser).getByTestId('drive-search'), { target: { value: 'smith' } })
    fireEvent.click(await screen.findByText('Smith Family'))
    expect(await screen.findByText('Evidence')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Use “Smith Family”/ }))
    await waitFor(() => expect(api.validateFolder).toHaveBeenCalledWith('x1')) // checked with Google before it becomes the destination
  })
})

describe('folder browser: long lists and permissions', () => {
  it('"Load more folders" fetches the next page and keeps the first page, so folders past 100 do not disappear', async () => {
    api.listFolders.mockImplementation((_parent, options) => (options?.pageToken === 'T2'
      ? ok({ folders: [{ id: 'p2', name: 'On page two', canAddChildren: true }], nextPageToken: null })
      : ok({ folders: [{ id: 'p1', name: 'On page one', canAddChildren: true }], nextPageToken: 'T2', recent: [] })))
    await openBrowser()
    expect(await screen.findByText('On page one')).toBeTruthy()
    fireEvent.click(screen.getByTestId('drive-load-more'))
    expect(await screen.findByText('On page two')).toBeTruthy()
    expect(screen.getByText('On page one')).toBeTruthy()
    expect(api.listFolders).toHaveBeenCalledWith('root', { pageToken: 'T2' })
    expect(screen.queryByTestId('drive-load-more')).toBeNull() // no more pages
  })

  it('a view-only folder is shown but cannot be chosen as a destination', async () => {
    api.listFolders.mockReturnValue(ok({ folders: [{ id: 'ro', name: 'Read only folder', canAddChildren: false }, { id: 'rw', name: 'Writable folder', canAddChildren: true }], recent: [] }))
    await openBrowser()
    await screen.findByText('Read only folder')
    expect(screen.getAllByText('View only').length).toBe(1)
    expect(screen.getAllByRole('button', { name: 'Select' }).length).toBe(1) // only the writable one
  })

  it('creating a new folder is not offered on a list that has no single place to create it', async () => {
    const browser = await openBrowser()
    fireEvent.click(within(browser).getByTestId('drive-tab-shared'))
    expect(await screen.findByText(/Open a folder to create a new folder inside it/)).toBeTruthy()
    expect(screen.queryByPlaceholderText(/New folder name/)).toBeNull() // never silently creates it in My Drive
  })
})
