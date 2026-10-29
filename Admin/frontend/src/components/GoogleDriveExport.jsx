import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Cloud, ExternalLink, FolderOpen, FolderPlus, Loader2, RefreshCw, X } from 'lucide-react'
import { googleDriveApi } from '../services/api'

// "Add to Drive": copies the selected case documents into a Google Drive folder. The files stay in Immiglance; Drive gets a copy
// (re-adding a changed file updates that same copy). Each team member connects and uses THEIR OWN Google account and folders.
// Renders nothing at all unless the server reports the feature as enabled, so it can never affect a screen where it is switched off.

const PICKER_KEY = import.meta.env.VITE_GOOGLE_PICKER_API_KEY
const PICKER_PROJECT = import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER
const PICKER_ENABLED = Boolean(PICKER_KEY && PICKER_PROJECT)
const FINAL_JOB = new Set(['completed', 'completed_with_errors', 'failed'])
const REASONS = {
  cancelled: 'Google sign-in was cancelled.',
  invalid_state: 'The connection link expired. Please try again.',
  scope_missing: 'Google Drive access was not granted. Please allow access to files created or opened with Immiglance.',
  no_refresh_token: 'Google did not return a long-lived authorization. Please try connecting again.',
  google_error: 'Google reported a problem. Please try again.',
  connect_failed: 'Could not connect Google Drive. Please try again.',
}

let statusPromise = null
let lastStatus = null
const cacheStatus = (data) => { lastStatus = data; statusPromise = Promise.resolve(data) }
// A failed re-check keeps the last known state, so a network blip can never make the button vanish or flip a connected user to "not connected".
const loadStatus = (force = false) => {
  if (!statusPromise || force) {
    statusPromise = googleDriveApi.status().then((res) => (lastStatus = res.data)).catch(() => lastStatus || { enabled: false })
  }
  return statusPromise
}

let pickerScript = null
const loadPicker = () => {
  if (window.google?.picker) return Promise.resolve()
  if (!pickerScript) {
    pickerScript = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = 'https://apis.google.com/js/api.js'
      script.async = true
      script.onload = () => window.gapi.load('picker', { callback: resolve, onerror: reject })
      script.onerror = () => { pickerScript = null; reject(new Error('Google Picker could not be loaded')) }
      document.head.appendChild(script)
    })
  }
  return pickerScript
}

const errorText = (error, fallback) => error?.response?.data?.message || fallback

// The Google Drive logo: three rounded lobes (green top, blue bottom-left, yellow right) around a triangular opening, with the soft
// gradients of the current Drive mark. Drawn inline (no image file) so it stays sharp at any size; every place the logo appears uses this.
export function DriveLogo({ className = 'h-4 w-4' }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '') // several logos can be on one page; their gradient ids must not collide
  const blue = `drive-blue-${uid}`
  const yellow = `drive-yellow-${uid}`
  const green = `drive-green-${uid}`
  return (
    <svg className={className} viewBox="0 0 1280 1186" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Google Drive" focusable="false">
      <defs>
        <linearGradient id={green} gradientUnits="userSpaceOnUse" x1="150" y1="560" x2="520" y2="470">
          <stop offset="0.12" stopColor="#7BC8FF" />
          <stop offset="0.6" stopColor="#3FBFA6" stopOpacity="0.8" />
          <stop offset="1" stopColor="#10BB5E" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={blue} gradientUnits="userSpaceOnUse" x1="400" y1="1040" x2="780" y2="1186">
          <stop offset="0" stopColor="#3385FF" />
          <stop offset="1" stopColor="#A8A5FF" />
        </linearGradient>
        <linearGradient id={yellow} gradientUnits="userSpaceOnUse" x1="700" y1="650" x2="1250" y2="1100">
          <stop offset="0" stopColor="#FFCB00" />
          <stop offset="1" stopColor="#FFE41A" />
        </linearGradient>
      </defs>
      <path d="M385 145A295 295 0 0 1 890 145L993 320 847 573H140Z" fill="#10BB5E" />
      <path d="M385 145 140 573H560Z" fill={`url(#${green})`} />
      <path d="M140 573H432L785 1186H290A293 293 0 0 1 38 748Z" fill={`url(#${blue})`} />
      <path d="M993 320 1240 748A293 293 0 0 1 990 1186H785L640 932 847 573Z" fill={`url(#${yellow})`} />
    </svg>
  )
}

// A folder browser used ONLY when Google's own folder window is not available (no Picker key on the server, it could not be opened, or the user
// chooses it). It walks the user's real Drive one level at a time, so any existing folder and subfolder can be reached.
function FolderBrowser({ onSelect, onLocation, disabled }) {
  const [trail, setTrail] = useState([{ id: 'root', name: 'My Drive' }])
  const [items, setItems] = useState(null)
  const [problem, setProblem] = useState('')
  const here = trail[trail.length - 1]

  useEffect(() => { onLocation(here.id === 'root' ? null : here) }, [here.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    let active = true
    setItems(null); setProblem('')
    googleDriveApi.listFolders(here.id)
      .then((res) => { if (active) setItems(res.data.folders || []) })
      .catch((err) => { if (active) { setItems([]); setProblem(err?.response?.data?.message || 'Could not list the folders.') } })
    return () => { active = false }
  }, [here.id])

  return (
    <div className="rounded-lg border border-border text-sm" data-testid="drive-browser">
      <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2 text-xs text-muted-foreground">
        {trail.map((crumb, index) => (
          <span key={crumb.id} className="flex items-center gap-1">
            {index > 0 && <span>/</span>}
            <button type="button" className="hover:underline" onClick={() => setTrail(trail.slice(0, index + 1))}>{crumb.name}</button>
          </span>
        ))}
      </div>
      <ul className="max-h-56 divide-y divide-border overflow-y-auto">
        {items === null && <li className="px-3 py-3 text-xs text-muted-foreground">Loading folders…</li>}
        {items?.length === 0 && <li className="px-3 py-3 text-xs text-muted-foreground">{problem || 'No folders here.'}</li>}
        {items?.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <button type="button" onClick={() => setTrail([...trail, { id: item.id, name: item.name }])} className="flex min-w-0 items-center gap-2 text-left text-foreground hover:underline"><FolderOpen className="h-4 w-4 shrink-0" /><span className="truncate">{item.name}</span></button>
            <button type="button" onClick={() => onSelect(item)} disabled={disabled} className="shrink-0 text-xs text-blue-600 hover:underline">Select</button>
          </li>
        ))}
      </ul>
      <div className="flex justify-end border-t border-border px-3 py-2"><button type="button" onClick={() => onSelect(here)} disabled={disabled} className="btn-secondary text-xs">Use “{here.name}”</button></div>
    </div>
  )
}

// The user's connected Google accounts: the active one is marked; they can switch to another, reconnect one that expired, or remove one.
function AccountList({ accounts, busy, onUse, onReconnect, onRemove }) {
  return (
    <ul className="divide-y divide-border rounded-lg border border-border text-sm" data-testid="drive-accounts">
      {accounts.map((account) => (
        <li key={account.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <DriveLogo className="h-4 w-4 shrink-0" />
            <span className="truncate text-foreground">{account.email || 'Google account'}</span>
            {account.active && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">Active</span>}
            {account.status === 'reconnect_required' && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">Needs reconnect</span>}
          </div>
          <div className="flex shrink-0 items-center gap-3 text-xs">
            {account.status === 'reconnect_required'
              ? <button type="button" onClick={onReconnect} disabled={busy} className="text-blue-600 hover:underline">Reconnect</button>
              : !account.active && <button type="button" onClick={() => onUse(account.id)} disabled={busy} className="text-blue-600 hover:underline">Use this Drive</button>}
            <button type="button" onClick={() => onRemove(account)} disabled={busy} className="text-red-600 hover:underline">Remove</button>
          </div>
        </li>
      ))}
    </ul>
  )
}

export default function GoogleDriveExport({ caseId, documents = [], getName = (doc) => doc.originalFileName || doc.originalName || doc.fileName || 'Document', className = '' }) {
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [folder, setFolder] = useState(null)
  const [browse, setBrowse] = useState(false) // true = use the in-app folder browser instead of Google's own window
  const [browseAt, setBrowseAt] = useState(null) // folder currently open in the browser (null = My Drive)
  const [newName, setNewName] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [links, setLinks] = useState({})
  const [busy, setBusy] = useState('')
  const [job, setJob] = useState(null)
  // 'files' = pick the documents here; 'folder' = pick the destination in Google's own Drive Picker.
  const [step, setStep] = useState('files')
  const [showAccounts, setShowAccounts] = useState(false)
  const pollRef = useRef(null)

  useEffect(() => {
    let active = true
    loadStatus().then((result) => { if (active) setStatus(result) })
    return () => { active = false }
  }, [])

  // Coming back from Google's consent screen: reopen the dialog and say how it went.
  useEffect(() => {
    if (!status?.enabled) return
    const params = new URLSearchParams(window.location.search)
    const outcome = params.get('gdrive')
    if (!outcome) return
    const reason = params.get('reason')
    params.delete('gdrive'); params.delete('reason')
    const query = params.toString()
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    setOpen(true)
    if (outcome === 'connected') { setNotice('Your Google Drive is connected.'); loadStatus(true).then(setStatus) }
    else setError(REASONS[reason] || REASONS.connect_failed)
  }, [status?.enabled])

  const stopPolling = useCallback(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }, [])
  useEffect(() => stopPolling, [stopPolling])

  const connected = Boolean(status?.connected)
  const accounts = status?.accounts || []
  const activeId = accounts.find((account) => account.active)?.id || ''
  const docs = useMemo(() => documents.filter((doc) => doc?._id), [documents])

  // When the dialog opens (and Drive is usable): start from the document step, and load which files already have a Drive copy.
  // Without a Google Picker key the app falls back to its own short folder list, so that is only loaded in that case.
  useEffect(() => {
    if (open) loadStatus(true).then(setStatus)
  }, [open])

  useEffect(() => {
    if (!open || !connected) return
    setSelected(new Set()); setStep('files'); setFolder(null); setBrowse(false)
    googleDriveApi.lookupLinks(docs.map((doc) => doc._id)).then((res) => setLinks(res.data.links || {})).catch(() => setLinks({}))
  }, [open, connected, activeId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!status?.enabled) return null

  // One place for API failures. If the connection itself is what failed (revoked, expired, never made), re-check it so the dialog
  // immediately offers Reconnect instead of repeating the same error.
  function fail(err, fallback) {
    const code = err?.response?.data?.code
    if (code === 'RECONNECT_REQUIRED' || code === 'NOT_CONNECTED') loadStatus(true).then(setStatus)
    setError(errorText(err, fallback))
  }

  const toggle = (id) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const allSelected = docs.length > 0 && selected.size === docs.length

  const connect = async () => {
    setBusy('connect'); setError('')
    try {
      const { data } = await googleDriveApi.connectStart(window.location.pathname)
      window.location.assign(data.authUrl)
    } catch (err) { fail(err, 'Could not start the Google connection.'); setBusy('') }
  }

  const applyStatus = (data) => { cacheStatus(data); setStatus(data) }

  // Switch which connected Google account the dialog uses. The folder belongs to the previous account, so the choice starts over.
  const switchAccount = async (accountId) => {
    setBusy('switch'); setError(''); setNotice('')
    try {
      const { data } = await googleDriveApi.activate(accountId)
      applyStatus(data); setFolder(null); setStep('files'); setSelected(new Set()); setShowAccounts(false)
      setNotice(`Now using ${data.email || 'that Google account'}.`)
    } catch (err) { fail(err, 'Could not switch Google account.') } finally { setBusy('') }
  }

  const removeAccount = async (account) => {
    if (!window.confirm(`Remove ${account.email || 'this Google account'} from Immiglance? Files already copied to that Drive stay there.`)) return
    setBusy('remove'); setError(''); setNotice('')
    try {
      const { data } = await googleDriveApi.removeAccount(account.id)
      applyStatus(data)
      if (account.active) { setFolder(null); setStep('files'); setSelected(new Set()) }
      setNotice(`${account.email || 'The Google account'} was removed.`)
    } catch (err) { fail(err, 'Could not remove the Google account.') } finally { setBusy('') }
  }

  // Checks a chosen folder with Google (it exists, is not in the trash, and the connected account can add to it) and makes it the destination.
  const useFolder = async (candidate) => {
    setBusy('check'); setError('')
    try {
      const { data } = await googleDriveApi.validateFolder(candidate.id)
      setFolder(data.folder)
    } catch (err) { fail(err, 'That folder cannot be used.') } finally { setBusy('') }
  }

  // Google's own Drive folder window (not an Immiglance list): the user's real Drive, including subfolders, "Shared with me" and shared drives.
  // The dialog is only "busy" while the token and Google's script load; once the window is on screen it is Google's, and a window that
  // fails to render (blocked script, API-key restriction) can never leave this dialog stuck.
  const chooseWithPicker = async () => {
    setBusy('pick'); setError('')
    try {
      const [{ data }] = await Promise.all([googleDriveApi.pickerToken(), loadPicker()])
      const { picker } = window.google
      const folders = 'application/vnd.google-apps.folder'
      const view = (id, label, configure = (v) => v) => configure(new picker.DocsView(id).setLabel(label).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes(folders))
      new picker.PickerBuilder()
        .addView(view(picker.ViewId.DOCS, 'My Drive', (v) => v.setParent('root'))) // opens My Drive; open folders to reach subfolders
        .addView(view(picker.ViewId.DOCS, 'Shared with me', (v) => v.setOwnedByMe(false)))
        .addView(view(picker.ViewId.DOCS, 'Shared drives', (v) => v.setEnableDrives(true)))
        .enableFeature(picker.Feature.SUPPORT_DRIVES)
        .setOAuthToken(data.accessToken)
        .setDeveloperKey(PICKER_KEY)
        .setAppId(PICKER_PROJECT)
        .setOrigin(`${window.location.protocol}//${window.location.host}`)
        .setTitle('Choose a destination folder in your Google Drive')
        .setCallback((result) => { if (result.action === picker.Action.PICKED && result.docs?.[0]) useFolder(result.docs[0]) })
        .build()
        .setVisible(true)
      setBusy('')
    } catch (err) {
      // Google's window could not be opened: say so and offer the in-app browser, which reaches the same folders.
      fail(err, "Google's folder window could not be opened. You can browse your folders here instead.")
      setBrowse(true); setBusy('')
    }
  }

  // "Next": the documents are chosen here; now Google's folder browser opens (or, without a Picker key, the simple fallback is shown).
  const next = () => { setStep('folder'); setError(''); if (PICKER_ENABLED) chooseWithPicker(); else setBrowse(true) }

  const createFolder = async () => {
    setBusy('create'); setError('')
    try {
      const { data } = await googleDriveApi.createFolder(newName.trim(), folder?.id || browseAt?.id)
      setFolder(data.folder); setNewName('')
    } catch (err) { fail(err, 'Could not create the folder.') } finally { setBusy('') }
  }

  const poll = (jobId) => {
    stopPolling()
    const tick = async () => {
      try {
        const { data } = await googleDriveApi.job(jobId)
        setJob(data.job)
        if (FINAL_JOB.has(data.job.status)) {
          stopPolling()
          if (data.job.items.some((item) => item.errorCode === 'RECONNECT_REQUIRED' || item.errorCode === 'NOT_CONNECTED')) loadStatus(true).then(setStatus)
          googleDriveApi.lookupLinks(docs.map((doc) => doc._id)).then((res) => setLinks(res.data.links || {})).catch(() => {})
        }
      } catch { /* keep polling; a transient error must not end progress updates */ }
    }
    tick()
    pollRef.current = setInterval(tick, 1500)
  }

  const start = async () => {
    setBusy('sync'); setError(''); setNotice('')
    try {
      const { data } = await googleDriveApi.sync({ documentIds: [...selected], folderId: folder.id, caseId })
      poll(data.jobId)
    } catch (err) { fail(err, 'Could not start adding files to Drive.') } finally { setBusy('') }
  }

  const retry = async () => {
    setBusy('retry'); setError('')
    try { await googleDriveApi.retry(job.id); poll(job.id) } catch (err) { fail(err, 'Could not retry.') } finally { setBusy('') }
  }

  const running = job && !FINAL_JOB.has(job.status)
  const nameFor = (id) => { const doc = docs.find((d) => String(d._id) === String(id)); return doc ? getName(doc) : 'Document' }
  const statusLabel = { pending: 'Waiting', uploading: 'Uploading…', synced: 'Added', updated: 'Updated in Drive', skipped: 'Skipped', failed: 'Failed' }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setNotice(''); setError('') }} className={`btn-secondary inline-flex items-center justify-center gap-2 text-sm ${className}`} data-testid="add-to-drive-button">
        <span>Add to Drive</span> <DriveLogo className="h-[18px] w-[18px]" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Add documents to Google Drive">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Add to Google Drive</h3>
                <p className="text-xs text-muted-foreground">Copies go to your own Google Drive. The files stay in Immiglance.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-5 overflow-y-auto px-6 py-4">
              {notice && <p className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> {notice}</p>}
              {error && <p className="flex items-start gap-2 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}

              {!connected && (
                <div className="rounded-xl border border-border p-4 text-sm">
                  {status.status === 'reconnect_required' ? <p className="mb-3 text-foreground">{status.lastError || `Your Google Drive access expired or was revoked${status.email ? ` for ${status.email}` : ''}.`}</p> : <p className="mb-3 text-foreground">Connect your own Google Drive to copy these documents into your folders. Each team member connects their own account.</p>}
                  <button type="button" onClick={connect} disabled={busy === 'connect' || !status.configured} className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60"><Cloud className="h-4 w-4" /> {busy === 'connect' ? 'Opening Google…' : status.status === 'reconnect_required' ? 'Reconnect my Google Drive' : 'Connect my Google Drive'}</button>
                  {!status.configured && <p className="mt-2 text-xs text-muted-foreground">Google Drive is not fully set up on the server yet. Please contact an administrator.</p>}
                  {accounts.length > 0 && <div className="mt-4"><p className="mb-1 text-xs text-muted-foreground">Your connected Google accounts</p><AccountList accounts={accounts} busy={Boolean(busy)} onUse={switchAccount} onReconnect={connect} onRemove={removeAccount} /></div>}
                </div>
              )}

              {connected && !job && (
                <>
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <button type="button" onClick={() => setShowAccounts((current) => !current)} className="min-w-0 truncate text-left hover:underline" aria-expanded={showAccounts} data-testid="drive-accounts-toggle">
                      Your Google Drive: <strong className="text-foreground">{status.email || 'Google account'}</strong> · {accounts.length > 1 ? `${accounts.length} accounts, switch` : 'manage'}
                    </button>
                    <button type="button" onClick={connect} disabled={busy === 'connect' || !status.configured} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-60" data-testid="drive-add-account">
                      <DriveLogo className="h-3.5 w-3.5" /> {busy === 'connect' ? 'Opening Google…' : 'Add another Drive'}
                    </button>
                  </div>
                  {showAccounts && <AccountList accounts={accounts} busy={Boolean(busy)} onUse={switchAccount} onReconnect={connect} onRemove={removeAccount} />}

                  {step === 'files' && (
                    <section>
                      <div className="mb-2 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-foreground">Step 1 of 2 · Select documents ({selected.size} of {docs.length} selected)</h4>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(docs.map((d) => d._id)))} /> Select all</label>
                      </div>
                      {docs.length === 0 ? <p className="text-sm text-muted-foreground">There are no documents on this case yet.</p> : (
                        <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                          {docs.map((doc) => (
                            <li key={doc._id}>
                              <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50">
                                <input type="checkbox" checked={selected.has(doc._id)} onChange={() => toggle(doc._id)} />
                                <span className="min-w-0 flex-1 truncate text-foreground">{getName(doc)}</span>
                                {links[doc._id]?.length > 0 && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700" title={links[doc._id].map((l) => l.folderName).join(', ')}>In Drive</span>}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>
                  )}

                  {step === 'folder' && (
                    <section>
                      <h4 className="mb-2 text-sm font-semibold text-foreground">Step 2 of 2 · Choose the destination folder in your Google Drive</h4>
                      <p className="mb-3 text-xs text-muted-foreground">{selected.size} document{selected.size === 1 ? '' : 's'} selected.{PICKER_ENABLED && !browse ? ' Google Drive opens in its own window so you can browse your real folders and subfolders.' : ''}</p>
                      {folder
                        ? <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm"><span className="flex items-center gap-2 text-foreground"><FolderOpen className="h-4 w-4" /> {folder.name}</span><button type="button" className="text-xs text-blue-600 hover:underline" disabled={busy === 'pick'} onClick={() => { if (PICKER_ENABLED && !browse) chooseWithPicker(); else setFolder(null) }}>Choose a different folder</button></div>
                        : PICKER_ENABLED && !browse
                          ? <div className="space-y-2"><div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground"><span className="flex-1">{busy === 'pick' ? 'Opening Google Drive…' : busy === 'check' ? 'Checking the folder…' : 'No folder chosen yet.'}</span><button type="button" onClick={chooseWithPicker} disabled={busy === 'pick' || busy === 'check'} className="btn-secondary inline-flex items-center gap-2 text-sm"><FolderOpen className="h-4 w-4" /> Open Google Drive</button></div><button type="button" onClick={() => setBrowse(true)} className="text-xs text-blue-600 hover:underline" data-testid="drive-browse-instead">Cannot see Google Drive&apos;s window? Browse your folders here instead</button></div>
                          : <FolderBrowser onSelect={useFolder} onLocation={setBrowseAt} disabled={busy === 'check'} />}
                      {(folder || browse || !PICKER_ENABLED) && (
                        <div className="mt-3">
                          <p className="mb-1 text-xs text-muted-foreground">{folder ? `Optional: create a new folder inside “${folder.name}” and use it instead` : browseAt ? `Or create a new folder inside “${browseAt.name}”` : 'Or create a new folder in My Drive'}</p>
                          <div className="flex gap-2">
                            <input className="input-field text-sm" placeholder={folder ? `New folder inside "${folder.name}"` : browseAt ? `New folder inside "${browseAt.name}"` : 'New folder name (created in My Drive)'} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} />
                            <button type="button" onClick={createFolder} disabled={!newName.trim() || busy === 'create'} className="btn-secondary inline-flex shrink-0 items-center gap-2 text-sm disabled:opacity-60"><FolderPlus className="h-4 w-4" /> {busy === 'create' ? 'Creating…' : 'Create'}</button>
                          </div>
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}

              {job && (
                <section data-testid="drive-job">
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                    {running ? <Loader2 className="h-4 w-4 animate-spin" /> : job.status === 'failed' ? <AlertCircle className="h-4 w-4 text-red-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
                    {running ? 'Adding to Drive…' : job.status === 'completed' ? 'Done' : job.status === 'failed' ? 'Nothing could be added' : 'Finished with some problems'}
                    <span className="font-normal text-muted-foreground">— {job.counts.synced + job.counts.updated} added, {job.counts.skipped} skipped, {job.counts.failed} failed</span>
                  </div>
                  <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
                    {job.items.map((item) => (
                      <li key={item.documentId} className="flex items-start justify-between gap-3 px-3 py-2">
                        <div className="min-w-0"><p className="truncate text-foreground">{item.name || nameFor(item.documentId)}</p>{item.reason && <p className={`text-xs ${item.status === 'failed' ? 'text-red-600' : 'text-muted-foreground'}`}>{item.reason}</p>}</div>
                        <span className={`shrink-0 text-xs ${item.status === 'failed' ? 'text-red-600' : item.status === 'synced' || item.status === 'updated' ? 'text-emerald-600' : 'text-muted-foreground'}`}>{statusLabel[item.status]}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-muted-foreground">The files are still in Immiglance. Your Drive now holds a copy in “{job.folderName}”.</p>
                </section>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
              <div>{job?.folderLink && !running && <a href={job.folderLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ExternalLink className="h-4 w-4" /> Open folder in Drive</a>}</div>
              <div className="flex gap-2">
                {job && !running && job.counts.failed > 0 && <button type="button" onClick={retry} disabled={busy === 'retry'} className="btn-secondary inline-flex items-center gap-2 text-sm"><RefreshCw className="h-4 w-4" /> Retry failed</button>}
                {job && !running && <button type="button" onClick={() => { setJob(null); setSelected(new Set()); setStep('files'); setFolder(null) }} className="btn-secondary text-sm">Add more</button>}
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-sm">{job && !running ? 'Close' : 'Cancel'}</button>
                {connected && !job && step === 'files' && <button type="button" onClick={next} disabled={selected.size === 0} className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60" data-testid="drive-next"><FolderOpen className="h-4 w-4" /> Next: choose folder</button>}
                {connected && !job && step === 'folder' && <button type="button" onClick={() => setStep('files')} className="btn-secondary text-sm" data-testid="drive-back">Back</button>}
                {connected && !job && step === 'folder' && <button type="button" onClick={start} disabled={!folder || selected.size === 0 || busy === 'sync' || busy === 'pick'} className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60" data-testid="drive-start"><Cloud className="h-4 w-4" /> {busy === 'sync' ? 'Starting…' : `Add ${selected.size || ''} file${selected.size === 1 ? '' : 's'} to Drive`}</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
