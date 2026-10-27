import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Loader2, FileText, Download, Eye, X, AlertCircle, CheckCircle, MessageSquare, UserCheck, Users } from 'lucide-react'
import { documentsApi, petitionReviewApi } from '../../services/api'
import { useOptionalSocket } from '../../contexts/SocketContext'
import { PetitionChatModal, timeLabel } from './PetitionFeedbackThread'
import ConfirmModal from '../../components/ConfirmModal'
import usePetitionStream, { prefetchPetition, waitUntilReady } from './usePetitionStream'
import { petitionReviewApi as reviewApi } from '../../services/api'

const AUDIENCE_LABEL = { client: 'the client', petitioner: 'the petitioner', employer: 'the employer' }

// Manual petition upload - separate from the auto-assembled
// PetitionPackage pipeline (PetitionVersionList/PetitionViewer above this on
// the page). Lets a case manager attach an actual petition PDF they
// authored outside the system; the resulting Document (documentType
// "petition_manual_upload") starts out visible to the case team only. The case
// manager then releases it, per petition, to the attorney(s) ("Attorney review"
// - they are e-mailed and see it in the Attorney Portal) and / or to the client
// side ("Client review" - only the single applicant / petitioner / employer is
// e-mailed and sees it on the Petition page of the Client Portal). Under each
// petition sits the latest feedback from the client, opening into the full
// conversation, live in both portals.
export default function PetitionUploadPanel({ caseId, canUpload, refreshSignal }) {
  const inputRef = useRef(null)
  const socket = useOptionalSocket()
  const [uploads, setUploads] = useState([])
  const [review, setReview] = useState({ audience: null, attorneys: 0, items: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [progress, setProgress] = useState(0)
  const [sending, setSending] = useState('') // `${documentId}:attorney|client`
  const [notice, setNotice] = useState('')
  const [justUploaded, setJustUploaded] = useState(null)
  const [chat, setChat] = useState(null)
  const [confirm, setConfirm] = useState(null) // { doc, target } waiting for the case manager's OK
  const hasLoadedOnce = useRef(false)

  const loadReview = useCallback(async () => {
    try {
      const res = await petitionReviewApi.list(caseId)
      setReview(res.data?.data || { audience: null, attorneys: 0, items: [] })
    } catch {
      // the release state is an add-on: the list of uploads still works without it
    }
  }, [caseId])

  const load = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true)
    try {
      const res = await documentsApi.listPetitionUploads(caseId)
      setUploads(res.data.documents || res.data.data || [])
      await loadReview()
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load uploaded petitions')
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }, [caseId, loadReview])

  useEffect(() => { load() }, [load, refreshSignal])

  // live: a client's new message / a release by a colleague shows up without a reload
  useEffect(() => {
    if (!socket?.subscribe) return undefined
    const caseMatches = (payload) => !payload?.caseId || String(payload.caseId) === String(caseId)
    const offMessage = socket.subscribe('petition:message', (payload) => { if (caseMatches(payload)) loadReview() })
    const offReview = socket.subscribe('petition:review', (payload) => { if (caseMatches(payload)) loadReview() })
    return () => { offMessage?.(); offReview?.() }
  }, [socket, caseId, loadReview])

  const reviewByDoc = useMemo(() => new Map((review.items || []).map((item) => [String(item.documentId), item])), [review.items])
  const audienceName = review.audience ? `${review.audience.name || 'the client'} (${review.audience.role})` : ''

  const MAX_PETITION_BYTES = 200 * 1024 * 1024

  const handleFile = async (file) => {
    if (!file) return
    if (file.size > MAX_PETITION_BYTES) {
      setError(`"${file.name}" is larger than the 200 MB limit.`)
      if (inputRef.current) inputRef.current.value = ''
      return
    }
    setUploading(true)
    setProgress(0)
    setError('')
    setNotice('')
    try {
      await documentsApi.uploadPetition(caseId, file, setProgress)
      if (inputRef.current) inputRef.current.value = ''
      const res = await documentsApi.listPetitionUploads(caseId)
      const docs = res.data.documents || res.data.data || []
      setUploads(docs)
      await loadReview()
      // the two options right after an upload: the newest petition is the one just uploaded
      const newest = [...docs].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0]
      setJustUploaded(newest ? String(newest._id) : null)
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Unable to upload the petition. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  const askRelease = (doc, target) => {
    if (target === 'client' && !review.audience) {
      setError('This case has no client account that can receive the petition yet.')
      return
    }
    setConfirm({ doc, target })
  }

  const release = async ({ doc, target }) => {
    const documentId = String(doc._id)
    setConfirm(null)
    setSending(`${documentId}:${target}`)
    setError('')
    setNotice('')
    try {
      if (target === 'attorney') {
        const res = await petitionReviewApi.sendToAttorney(caseId, documentId)
        const count = res.data?.data?.attorneysNotified || 1
        setNotice(`Sent for attorney review - ${count} attorney${count > 1 ? 's were' : ' was'} notified.`)
      } else {
        await petitionReviewApi.sendToClient(caseId, documentId)
        setNotice(`Sent for client review - ${audienceName} was notified.`)
      }
      if (justUploaded === documentId) setJustUploaded(null)
      await loadReview()
    } catch (e) {
      setError(e.response?.data?.message || `Unable to send the petition for ${target} review.`)
    } finally {
      setSending('')
    }
  }

  if (loading) return null

  const releaseButtons = (doc) => {
    const info = reviewByDoc.get(String(doc._id))
    const busyAttorney = sending === `${doc._id}:attorney`
    const busyClient = sending === `${doc._id}:client`
    const base = `inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50`
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => askRelease(doc, 'attorney')} disabled={Boolean(sending) || uploading || review.attorneys === 0} title={review.attorneys === 0 ? 'Grant an attorney access to this case first' : 'E-mail the attorney(s) and show the petition in the Attorney Portal'} className={`${base} border-primary/40 bg-primary/5 text-primary hover:bg-primary/10`}>
          {busyAttorney ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
          {info?.attorneyReview ? 'Send to attorney again' : 'Attorney review'}
        </button>
        <button type="button" onClick={() => askRelease(doc, 'client')} disabled={Boolean(sending) || uploading || !review.audience} title={review.audience ? `E-mail ${audienceName} and show the petition on their Petition page` : 'This case has no client account to send it to yet'} className={`${base} border-primary bg-primary text-primary-foreground hover:opacity-90`}>
          {busyClient ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
          {info?.clientReview ? 'Send to client again' : 'Client review'}
        </button>
      </div>
    )
  }

  const justUploadedDoc = justUploaded ? uploads.find((doc) => String(doc._id) === justUploaded) : null

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-foreground">Petition</h3>
          <p className="text-xs text-muted-foreground">Upload the petition as many times as needed (PDF, up to 200 MB each, up to 10). A new upload is visible to the case team only until you send it for attorney review and / or client review.</p>
        </div>
        {canUpload && (
          <>
            <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="btn-secondary inline-flex items-center gap-2 !py-1.5 !px-3 text-xs">
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? `Uploading ${progress}%` : 'Upload Petition'}
            </button>
          </>
        )}
      </div>

      {uploading && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {canUpload && justUploadedDoc && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5" role="status">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><CheckCircle className="h-4 w-4 text-primary" /> Petition uploaded - who should review it?</p>
            <p className="truncate text-xs text-muted-foreground">{justUploadedDoc.originalName || justUploadedDoc.fileName}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {releaseButtons(justUploadedDoc)}
            <button type="button" onClick={() => setJustUploaded(null)} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Later</button>
          </div>
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
          <CheckCircle className="h-4 w-4 shrink-0" /> {notice}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {uploads.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">No petition has been uploaded for this case yet.</p>
      )}

      {uploads.length > 0 && (
        <div className="divide-y divide-border">
          {uploads.map((doc) => {
            const info = reviewByDoc.get(String(doc._id))
            const messages = info?.messages || { total: 0, unread: 0, latest: [] }
            return (
              <div key={doc._id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold tracking-tight text-foreground">{doc.originalName || doc.fileName}</p>
                      <p className="text-xs text-muted-foreground">{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : ''}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <button onClick={() => setPreviewDoc(doc)} onMouseEnter={() => prefetchPetition(String(doc._id))} onFocus={() => prefetchPetition(String(doc._id))} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      <Eye className="h-3.5 w-3.5" /> View
                    </button>
                    <button
                      onClick={async () => {
                        const res = await documentsApi.download(doc._id)
                        const url = URL.createObjectURL(res.data)
                        const link = document.createElement('a')
                        link.href = url
                        link.download = doc.originalName || doc.fileName || 'petition.pdf'
                        link.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </button>
                  </div>
                </div>

                {/* where this petition stands, and the two ways to send it on */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${info?.attorneyReview ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                    <UserCheck className="h-3 w-3" /> {info?.attorneyReview ? `Attorney review sent ${timeLabel(info.attorneyReview.sentAt)}` : 'Not sent to the attorney'}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${info?.clientReview ? 'bg-green-100 text-green-700' : 'bg-muted text-muted-foreground'}`}>
                    <Users className="h-3 w-3" /> {info?.clientReview ? `Client review sent ${timeLabel(info.clientReview.sentAt)}` : 'Not sent to the client'}
                  </span>
                  {canUpload && releaseButtons(doc)}
                </div>

                {/* the client's latest feedback, under the petition in the same block; it opens into the whole conversation */}
                {info?.clientReview && (
                  <button
                    type="button"
                    onClick={() => setChat({ documentId: String(doc._id), fileName: doc.originalName || doc.fileName, audienceLabel: review.audience?.name })}
                    className="mt-3 block w-full rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-left transition hover:border-primary/50 hover:bg-primary/10"
                    aria-label={`Open the feedback conversation for ${doc.originalName || doc.fileName}`}
                  >
                    <span className="flex items-center justify-between text-xs font-semibold text-primary">
                      <span className="inline-flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> Client feedback{messages.total > messages.latest.length ? ` · latest ${messages.latest.length} of ${messages.total}` : ''}
                        {messages.unread > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">{messages.unread} new</span>}
                      </span>
                      <span>Open conversation</span>
                    </span>
                    {messages.latest.length === 0 ? (
                      <span className="mt-1.5 block text-xs text-muted-foreground">No feedback from the client yet. You can start the conversation too.</span>
                    ) : (
                      <span className="mt-1 block space-y-0.5">
                        {messages.latest.map((message) => (
                          <span key={message._id} className="flex gap-2 text-xs">
                            <span className="w-24 shrink-0 truncate font-semibold text-foreground">{message.side === 'client' ? (message.authorName || 'Client') : 'You'}</span>
                            <span className="min-w-0 flex-1 truncate text-foreground/80">{message.body}</span>
                            <span className="hidden shrink-0 text-muted-foreground sm:inline">{timeLabel(message.createdAt)}</span>
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {previewDoc && (
        <PetitionUploadPreviewModal doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.target === 'attorney' ? 'Send for attorney review?' : 'Send for client review?'}
          message={confirm.target === 'attorney'
            ? 'The attorney(s) on this case will be emailed and will see this petition in the Attorney Portal.'
            : `${audienceName} will be emailed and will see this petition on the Petition page of the Client Portal.`}
          confirmLabel={confirm.target === 'attorney' ? 'Send to attorney' : 'Send to client'}
          onConfirm={() => release(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}
      {chat && <PetitionChatModal item={chat} onClose={() => { setChat(null); loadReview() }} onChanged={loadReview} />}
    </div>
  )
}

// Full-screen petition viewer. The PDF fills the whole screen; the file name, Download and close sit INSIDE the PDF box (a small floating bar over the dark margin beside the
// page, just below the viewer's own toolbar) so no space is spent on a header of our own. The file is streamed into the browser's PDF viewer - page 1 shows while the rest
// loads - and while the server prepares a very large petition we show "Opening…" and keep trying by ourselves: no timeout message. Esc closes.
export function PetitionUploadPreviewModal({ doc, onClose }) {
  const documentId = String(doc._id)
  const { status, url, error, waited, retry } = usePetitionStream(documentId)
  const [painted, setPainted] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const name = doc.originalName || doc.fileName || 'petition.pdf'

  useEffect(() => { setPainted(false) }, [url])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous }
  }, [onClose])

  const download = async () => {
    setDownloading(true)
    try {
      const token = await waitUntilReady(documentId)
      const link = document.createElement('a')
      link.href = reviewApi.streamUrl(token, { download: true })
      link.download = name
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch {
      // the stream is retried by itself; a failure here only means the file is gone - the viewer already says so
    } finally {
      setDownloading(false)
    }
  }

  const opening = status === 'preparing' || (status === 'ready' && !painted)

  return (
    <div className="fixed inset-0 z-50 bg-neutral-900" role="dialog" aria-modal="true" aria-label={`Petition: ${name}`}>
      {status === 'ready' && <iframe title="petition-preview" src={url} onLoad={() => setPainted(true)} className="h-full w-full border-0" />}

      {status === 'error' && (
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <p className="text-sm">{error}</p>
          <button type="button" onClick={retry} className="btn-primary">Try again</button>
        </div>
      )}

      {opening && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900 p-6 text-center text-white" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm font-semibold">Opening the petition…</p>
          {waited && <p className="max-w-sm text-xs leading-relaxed text-white/70">A large petition can take a minute to prepare. It keeps trying automatically - nothing to do.</p>}
        </div>
      )}

      <div className="absolute right-6 top-16 z-10 flex max-w-[calc(100%-3rem)] items-center gap-2 rounded-xl bg-black/70 px-3 py-2 text-white shadow-lg backdrop-blur">
        <p className="min-w-0 max-w-[16rem] truncate text-sm font-semibold" title={name}>{name}</p>
        <button type="button" onClick={download} disabled={downloading} title="Download" aria-label="Download the petition" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-white/15 disabled:opacity-50">
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </button>
        <button type="button" onClick={onClose} title="Close" aria-label="Close the petition" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition hover:bg-white/15">
          <X className="h-5 w-5" />
        </button>
      </div>
    </div>
  )
}
