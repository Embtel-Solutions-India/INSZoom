import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, Cloud, ExternalLink, FolderOpen, FolderPlus, Loader2, RefreshCw, X } from 'lucide-react'
import { googleDriveApi } from '../services/api'

// "Add to Drive": copies the selected case documents into a Google Drive folder. The files stay in Immiglance; Drive gets a copy
// (re-adding a changed file updates that same copy). The Google account is the ORGANISATION's, connected once by an admin.
// Renders nothing at all unless the server reports the feature as enabled, so it can never affect a screen where it is switched off.

const PICKER_KEY = import.meta.env.VITE_GOOGLE_PICKER_API_KEY
const PICKER_PROJECT = import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER
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
const loadStatus = (force = false) => {
  if (!statusPromise || force) {
    statusPromise = googleDriveApi.status().then((res) => res.data).catch(() => ({ enabled: false }))
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

export default function GoogleDriveExport({ caseId, documents = [], getName = (doc) => doc.originalFileName || doc.originalName || doc.fileName || 'Document', className = '' }) {
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [folder, setFolder] = useState(null)
  const [folders, setFolders] = useState([])
  const [newName, setNewName] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [links, setLinks] = useState({})
  const [busy, setBusy] = useState('')
  const [job, setJob] = useState(null)
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
    if (outcome === 'connected') { setNotice('Google Drive is connected.'); loadStatus(true).then(setStatus) }
    else setError(REASONS[reason] || REASONS.connect_failed)
  }, [status?.enabled])

  const stopPolling = useCallback(() => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null } }, [])
  useEffect(() => stopPolling, [stopPolling])

  const connected = Boolean(status?.connected)
  const docs = useMemo(() => documents.filter((doc) => doc?._id), [documents])

  // When the dialog opens (and Drive is usable): reset the selection, and load recent folders and which files already have a Drive copy.
  useEffect(() => {
    if (!open || !connected) return
    setSelected(new Set())
    googleDriveApi.listFolders().then((res) => setFolders([...(res.data.recent || []), ...(res.data.folders || [])].filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i))).catch(() => setFolders([]))
    googleDriveApi.lookupLinks(docs.map((doc) => doc._id)).then((res) => setLinks(res.data.links || {})).catch(() => setLinks({}))
  }, [open, connected]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!status?.enabled) return null

  const toggle = (id) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next })
  const allSelected = docs.length > 0 && selected.size === docs.length

  const connect = async () => {
    setBusy('connect'); setError('')
    try {
      const { data } = await googleDriveApi.connectStart(window.location.pathname)
      window.location.assign(data.authUrl)
    } catch (err) { setError(errorText(err, 'Could not start the Google connection.')); setBusy('') }
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect Google Drive for the whole organisation? Files already copied to Drive stay there.')) return
    setBusy('disconnect'); setError('')
    try { await googleDriveApi.disconnect(); setStatus(await loadStatus(true)); setFolder(null); setNotice('Google Drive was disconnected.') }
    catch (err) { setError(errorText(err, 'Could not disconnect.')) } finally { setBusy('') }
  }

  const chooseWithPicker = async () => {
    setBusy('pick'); setError('')
    try {
      const [{ data }] = await Promise.all([googleDriveApi.pickerToken(), loadPicker()])
      const { picker } = window.google
      const view = new picker.DocsView(picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setMimeTypes('application/vnd.google-apps.folder')
      new picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(data.accessToken)
        .setDeveloperKey(PICKER_KEY)
        .setAppId(PICKER_PROJECT)
        .setTitle('Choose a destination folder')
        .setCallback(async (result) => {
          if (result.action !== picker.Action.PICKED) { if (result.action === picker.Action.CANCEL) setBusy(''); return }
          try {
            const { data: checked } = await googleDriveApi.validateFolder(result.docs[0].id)
            setFolder(checked.folder)
          } catch (err) { setError(errorText(err, 'That folder cannot be used.')) } finally { setBusy('') }
        })
        .build()
        .setVisible(true)
    } catch (err) { setError(errorText(err, 'Google Picker could not be opened. You can still create a new folder.')); setBusy('') }
  }

  const createFolder = async () => {
    setBusy('create'); setError('')
    try {
      const { data } = await googleDriveApi.createFolder(newName.trim(), folder?.id)
      setFolder(data.folder); setNewName(''); setFolders((current) => [data.folder, ...current])
    } catch (err) { setError(errorText(err, 'Could not create the folder.')) } finally { setBusy('') }
  }

  const poll = (jobId) => {
    stopPolling()
    const tick = async () => {
      try {
        const { data } = await googleDriveApi.job(jobId)
        setJob(data.job)
        if (FINAL_JOB.has(data.job.status)) {
          stopPolling()
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
    } catch (err) { setError(errorText(err, 'Could not start adding files to Drive.')) } finally { setBusy('') }
  }

  const retry = async () => {
    setBusy('retry'); setError('')
    try { await googleDriveApi.retry(job.id); poll(job.id) } catch (err) { setError(errorText(err, 'Could not retry.')) } finally { setBusy('') }
  }

  const running = job && !FINAL_JOB.has(job.status)
  const nameFor = (id) => { const doc = docs.find((d) => String(d._id) === String(id)); return doc ? getName(doc) : 'Document' }
  const statusLabel = { pending: 'Waiting', uploading: 'Uploading…', synced: 'Added', updated: 'Updated in Drive', skipped: 'Skipped', failed: 'Failed' }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setNotice(''); setError('') }} className={`btn-secondary inline-flex items-center justify-center gap-2 text-sm ${className}`} data-testid="add-to-drive-button">
        <Cloud className="h-4 w-4" /> Add to Drive
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Add documents to Google Drive">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Add to Google Drive</h3>
                <p className="text-xs text-muted-foreground">Copies go to Drive. The files stay in Immiglance.</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>

            <div className="space-y-5 overflow-y-auto px-6 py-4">
              {notice && <p className="flex items-center gap-2 text-sm text-emerald-600"><CheckCircle2 className="h-4 w-4" /> {notice}</p>}
              {error && <p className="flex items-start gap-2 text-sm text-red-600"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}

              {!connected && (
                <div className="rounded-xl border border-border p-4 text-sm">
                  {status.status === 'reconnect_required' ? <p className="mb-3 text-foreground">Google Drive access expired or was revoked{status.email ? ` for ${status.email}` : ''}.</p> : <p className="mb-3 text-foreground">Google Drive is not connected yet. One connection is shared by the whole team.</p>}
                  {status.canManage
                    ? <button type="button" onClick={connect} disabled={busy === 'connect' || !status.configured} className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60"><Cloud className="h-4 w-4" /> {busy === 'connect' ? 'Opening Google…' : status.status === 'reconnect_required' ? 'Reconnect Google Drive' : 'Connect Google Drive'}</button>
                    : <p className="text-muted-foreground">Ask an administrator to connect Google Drive.</p>}
                  {status.canManage && !status.configured && <p className="mt-2 text-xs text-muted-foreground">The server is missing Google Drive settings; check the backend configuration.</p>}
                </div>
              )}

              {connected && !job && (
                <>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Connected as <strong className="text-foreground">{status.email || 'Google account'}</strong></span>
                    {status.canManage && <button type="button" onClick={disconnect} disabled={busy === 'disconnect'} className="text-red-600 hover:underline">Disconnect</button>}
                  </div>

                  <section>
                    <h4 className="mb-2 text-sm font-semibold text-foreground">1. Destination folder</h4>
                    {folder
                      ? <div className="flex items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-sm"><span className="flex items-center gap-2 text-foreground"><FolderOpen className="h-4 w-4" /> {folder.name}</span><button type="button" className="text-xs text-blue-600 hover:underline" onClick={() => setFolder(null)}>Change</button></div>
                      : (
                        <div className="space-y-3">
                          {PICKER_KEY && PICKER_PROJECT && (
                            <button type="button" onClick={chooseWithPicker} disabled={busy === 'pick'} className="btn-secondary inline-flex items-center gap-2 text-sm"><FolderOpen className="h-4 w-4" /> {busy === 'pick' ? 'Opening…' : 'Choose a folder from Google Drive'}</button>
                          )}
                          {folders.length > 0 && (
                            <div>
                              <p className="mb-1 text-xs text-muted-foreground">Recent and Immiglance-created folders</p>
                              <div className="flex flex-wrap gap-2">{folders.map((f) => <button key={f.id} type="button" onClick={() => setFolder(f)} className="rounded-full border border-border px-3 py-1 text-xs text-foreground hover:bg-muted">{f.name}</button>)}</div>
                            </div>
                          )}
                        </div>
                      )}
                    <div className="mt-3 flex gap-2">
                      <input className="input-field text-sm" placeholder={folder ? `New folder inside "${folder.name}"` : 'New folder name (created in My Drive)'} value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={200} />
                      <button type="button" onClick={createFolder} disabled={!newName.trim() || busy === 'create'} className="btn-secondary inline-flex shrink-0 items-center gap-2 text-sm disabled:opacity-60"><FolderPlus className="h-4 w-4" /> {busy === 'create' ? 'Creating…' : 'Create'}</button>
                    </div>
                  </section>

                  <section>
                    <div className="mb-2 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-foreground">2. Documents ({selected.size} of {docs.length} selected)</h4>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(docs.map((d) => d._id)))} /> Select all</label>
                    </div>
                    {docs.length === 0 ? <p className="text-sm text-muted-foreground">There are no documents on this case yet.</p> : (
                      <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-lg border border-border">
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
                  <p className="mt-2 text-xs text-muted-foreground">The files are still in Immiglance. Drive now holds a copy in “{job.folderName}”.</p>
                </section>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-border px-6 py-4">
              <div>{job?.folderLink && !running && <a href={job.folderLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"><ExternalLink className="h-4 w-4" /> Open folder in Drive</a>}</div>
              <div className="flex gap-2">
                {job && !running && job.counts.failed > 0 && <button type="button" onClick={retry} disabled={busy === 'retry'} className="btn-secondary inline-flex items-center gap-2 text-sm"><RefreshCw className="h-4 w-4" /> Retry failed</button>}
                {job && !running && <button type="button" onClick={() => { setJob(null); setSelected(new Set()) }} className="btn-secondary text-sm">Add more</button>}
                <button type="button" onClick={() => setOpen(false)} className="btn-secondary text-sm">{job && !running ? 'Close' : 'Cancel'}</button>
                {connected && !job && <button type="button" onClick={start} disabled={!folder || selected.size === 0 || busy === 'sync'} className="btn-primary inline-flex items-center gap-2 text-sm disabled:opacity-60" data-testid="drive-start"><Cloud className="h-4 w-4" /> {busy === 'sync' ? 'Starting…' : `Add ${selected.size || ''} file${selected.size === 1 ? '' : 's'} to Drive`}</button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
