import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Upload, Loader2, FileText, Paperclip, Trash2, Download, Eye, X, AlertCircle, CheckCircle, MessageSquare, UserCheck, Users, Sparkles } from 'lucide-react'
import { documentsApi, petitionReviewApi, petitionAiReviewApi } from '../../services/api'
import { aiStatusOf, TONE_CLASS } from './petitionAiStatus'
import { useOptionalSocket } from '../../contexts/SocketContext'
import { PetitionChatModal, timeLabel } from './PetitionFeedbackThread'
import ConfirmModal from '../../components/ConfirmModal'
import usePetitionStream, { prefetchPetition, waitUntilReady, getViewLink } from './usePetitionStream'
import { petitionReviewApi as reviewApi } from '../../services/api'

const WARM_PETITIONS = 3
// The same panel serves the petition and, below it, "Supporting Documents" (letters, reports ... shared for review apart from the petition: no AI review,
// own e-mails). Only the wording, the document type and the AI add-on differ.
const KIND = {
  petition: {
    documentType: 'petition_manual_upload', title: 'Petition', noun: 'petition', Noun: 'Petition',
    help: 'Upload the petition as a PDF (up to 200 MB). Only your team can see it until you send it to the attorney or the client.',
    uploadLabel: 'Upload Petition', empty: 'No petition has been uploaded for this case yet.', fallbackName: 'petition.pdf',
    attorneyLabel: 'Attorney review', clientLabel: 'Client review',
    dropTitle: 'Drag and drop the petition PDF here', dropRelease: 'Release to upload the petition', dropBad: 'The petition must be a PDF file.', dropMany: 'Drop one petition PDF at a time.',
  },
  supporting: {
    documentType: 'petition_supporting_upload', title: 'Supporting Documents', noun: 'document', Noun: 'Document',
    help: 'Upload letters, reports or other documents as PDFs (up to 200 MB). Only your team can see them until you send them to the attorney or the client.',
    uploadLabel: 'Upload Document', empty: 'No supporting document has been uploaded for this case yet.', fallbackName: 'document.pdf',
    attorneyLabel: 'Send to attorney', clientLabel: 'Send to client',
    dropTitle: 'Drag and drop the supporting document PDF here', dropRelease: 'Release to upload the document', dropBad: 'A supporting document must be a PDF file.', dropMany: 'Drop one document PDF at a time.',
  },
}
const AUDIENCE_LABEL = { client: 'the client', petitioner: 'the petitioner', employer: 'the employer' }
// Petition AI Review: the findings panel is loaded only when opened, so this page's own code and first paint are unchanged
const PetitionAiReviewPanel = lazy(() => import('./PetitionAiReviewPanel'))

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
export default function PetitionUploadPanel({ caseId, canUpload, refreshSignal, kind = 'petition' }) {
  const text = KIND[kind] || KIND.petition
  const supporting = kind === 'supporting'
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
  const [chat, setChat] = useState(null)
  const [confirm, setConfirm] = useState(null) // { doc, target } waiting for the case manager's OK
  const [releaseNote, setReleaseNote] = useState('') // optional note typed in the send popup: shown in the e-mail and to the attorney
  const [deleting, setDeleting] = useState(null) // the document waiting for the delete confirmation
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Petition AI Review (staff): null = not available (switched off with no results, or the API answered with an error) - then nothing new is shown
  const [ai, setAi] = useState(null) // { enabled, byDoc: Map(documentId -> scan summary) }
  const [aiOpen, setAiOpen] = useState(null) // the petition whose AI Review panel is open
  const [aiSignal, setAiSignal] = useState(0) // bumped on a live event so the open panel re-reads
  const hasLoadedOnce = useRef(false)

  const loadReview = useCallback(async () => {
    try {
      const res = await petitionReviewApi.list(caseId)
      setReview(res.data?.data || { audience: null, attorneys: 0, items: [] })
    } catch {
      // the release state is an add-on: the list of uploads still works without it
    }
  }, [caseId])

  const loadAi = useCallback(async () => {
    if (supporting) { setAi(null); return } // no AI review for supporting documents
    try {
      const res = await petitionAiReviewApi.listForCase(caseId)
      const data = res.data?.data || {}
      const byDoc = new Map((data.petitions || []).map((item) => [String(item.documentId), item.scan]))
      setAi(data.enabled || [...byDoc.values()].some(Boolean) ? { enabled: Boolean(data.enabled), byDoc } : null)
    } catch {
      setAi(null) // an add-on: the petition list works exactly as before without it
    }
  }, [caseId, supporting])

  // Speed (2026-11-04): asking for a viewer link makes the server start reading the petition into memory, so by the time someone clicks View
  // it is usually ready. Only the newest few petitions, once per petition while this page is open; quiet, never throws, never blocks the list.
  const warmed = useRef(new Set())
  const warmLatest = useCallback((list) => {
    try {
      const newest = [...(list || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)).slice(0, WARM_PETITIONS)
      for (const doc of newest) {
        const id = String(doc?._id || '')
        if (!id || warmed.current.has(id)) continue
        warmed.current.add(id)
        Promise.resolve().then(() => getViewLink(id)).catch(() => {})
      }
    } catch {
      // only a speed-up
    }
  }, [])

  const load = useCallback(async () => {
    if (!hasLoadedOnce.current) setLoading(true)
    try {
      const res = await (supporting ? documentsApi.listSupportingUploads(caseId) : documentsApi.listPetitionUploads(caseId))
      const list = res.data.documents || res.data.data || []
      setUploads(list)
      warmLatest(list)
      await Promise.all([loadReview(), loadAi()])
    } catch (e) {
      setError(e.response?.data?.message || (supporting ? 'Failed to load the supporting documents' : 'Failed to load uploaded petitions'))
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }, [caseId, loadReview, loadAi, warmLatest, supporting])

  useEffect(() => { load() }, [load, refreshSignal])

  // live: a client's new message / a release by a colleague shows up without a reload
  useEffect(() => {
    if (!socket?.subscribe) return undefined
    const caseMatches = (payload) => !payload?.caseId || String(payload.caseId) === String(caseId)
    const offMessage = socket.subscribe('petition:message', (payload) => { if (caseMatches(payload)) loadReview() })
    const offReview = socket.subscribe('petition:review', (payload) => { if (caseMatches(payload)) loadReview() })
    // AI review progress / finished (the server sends at most one progress event per scan every 2 s)
    const offAi = socket.subscribe('petition:ai_review', (payload) => { if (caseMatches(payload)) { loadAi(); setAiSignal((n) => n + 1) } })
    return () => { offMessage?.(); offReview?.(); offAi?.() }
  }, [socket, caseId, loadReview, loadAi])

  const reviewByDoc = useMemo(() => new Map((review.items || []).map((item) => [String(item.documentId), item])), [review.items])
  const audienceName = review.audience ? `${review.audience.name || 'the client'} (${review.audience.role})` : ''

  const MAX_PETITION_BYTES = 200 * 1024 * 1024

  // drag & drop: the same upload as the button, one PDF at a time (the picker is PDF-only too)
  const dragDepth = useRef(0)
  const [dragOver, setDragOver] = useState(false)
  const handleDropped = (fileList) => {
    const files = Array.from(fileList || [])
    if (!files.length) return
    if (files.length > 1) { setError(text.dropMany); return }
    const [file] = files
    if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name || '')) { setError(`"${file.name}" is not a PDF. ${text.dropBad}`); return }
    handleFile(file)
  }

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
      await documentsApi.uploadPetition(caseId, file, setProgress, text.documentType)
      if (inputRef.current) inputRef.current.value = ''
      const res = await (supporting ? documentsApi.listSupportingUploads(caseId) : documentsApi.listPetitionUploads(caseId))
      const docs = res.data.documents || res.data.data || []
      setUploads(docs)
      await Promise.all([loadReview(), loadAi()])
    } catch (e) {
      setError(e.response?.data?.message || e.message || `Unable to upload the ${text.noun}. Please try again.`)
    } finally {
      setUploading(false)
    }
  }

  const askRelease = (doc, target) => {
    if (target === 'client' && !review.audience) {
      setError(`This case has no client account that can receive the ${text.noun} yet.`)
      return
    }
    setReleaseNote('')
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
        const res = await petitionReviewApi.sendToAttorney(caseId, documentId, releaseNote.trim())
        const count = res.data?.data?.attorneysNotified || 1
        setNotice(`Sent for attorney review - ${count} attorney${count > 1 ? 's were' : ' was'} notified.`)
      } else {
        await petitionReviewApi.sendToClient(caseId, documentId, releaseNote.trim())
        setNotice(`Sent for client review - ${audienceName} was notified.`)
      }
      await loadReview()
    } catch (e) {
      setError(e.response?.data?.message || `Unable to send the ${text.noun} for ${target} review.`)
    } finally {
      setSending('')
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError('')
    try {
      await documentsApi.remove(String(deleting._id))
      const removedId = String(deleting._id)
      setDeleting(null)
      setUploads((current) => current.filter((doc) => String(doc._id) !== removedId))
      setNotice(`${text.Noun} deleted.`)
      setError('')
      await loadReview()
    } catch (e) {
      setDeleteError(e.response?.data?.message || `Unable to delete the ${text.noun}. Please try again.`)
    } finally {
      setDeleteBusy(false)
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
        <button type="button" onClick={() => askRelease(doc, 'attorney')} disabled={Boolean(sending) || uploading || review.attorneys === 0} title={review.attorneys === 0 ? 'Grant an attorney access to this case first' : `E-mail the attorney(s) and show the ${text.noun} in the Attorney Portal`} className={`${base} border-primary/40 bg-primary/5 text-primary hover:bg-primary/10`}>
          {busyAttorney ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
          {info?.attorneyReview ? 'Send to attorney again' : text.attorneyLabel}
        </button>
        <button type="button" onClick={() => askRelease(doc, 'client')} disabled={Boolean(sending) || uploading || !review.audience} title={review.audience ? `E-mail ${audienceName} and show the ${text.noun} on their Petition page` : 'This case has no client account to send it to yet'} className={`${base} border-primary bg-primary text-primary-foreground hover:opacity-90`}>
          {busyClient ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
          {info?.clientReview ? 'Send to client again' : text.clientLabel}
        </button>
      </div>
    )
  }


  return (
    // the petition is the main panel (larger title, blue icon, solid button - no coloured border, which read as "selected"); Supporting Documents below it stays plain
    <div className="card space-y-3" data-kind={kind}>
      <div className="flex items-start justify-between gap-3 max-sm:flex-wrap">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={`flex shrink-0 items-center justify-center rounded-lg ${supporting ? 'h-8 w-8 bg-muted text-muted-foreground' : 'h-10 w-10 bg-primary text-primary-foreground'}`} aria-hidden="true">
            {supporting ? <Paperclip className="h-4 w-4" /> : <FileText className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <h3 className={supporting ? 'text-sm font-semibold text-foreground' : 'text-lg font-bold tracking-tight text-foreground'}>{text.title}</h3>
            <p className="text-xs text-muted-foreground">{text.help}</p>
          </div>
        </div>
        {canUpload && (
          <>
            <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className={`${supporting ? 'btn-secondary' : 'btn-primary'} inline-flex shrink-0 items-center gap-2 whitespace-nowrap !py-1.5 !px-3 text-xs`}>
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {uploading ? `Uploading ${progress}%` : text.uploadLabel}
            </button>
          </>
        )}
      </div>

      {/* Drag & drop area (petition AND supporting documents): click it to pick the PDF from the computer, or drag a PDF in from outside the app and release it here. Same upload as the button above. */}
      {canUpload && (
        <div
          role="button"
          tabIndex={uploading ? -1 : 0}
          aria-disabled={uploading}
          aria-label={`Upload the ${text.noun}: click to choose a PDF, or drag and drop it here`}
          data-testid="petition-drop-zone" data-kind={kind}
          onClick={() => { if (!uploading) inputRef.current?.click() }}
          onKeyDown={(event) => { if ((event.key === 'Enter' || event.key === ' ') && !uploading) { event.preventDefault(); inputRef.current?.click() } }}
          onDragEnter={(event) => { event.preventDefault(); if (!uploading) dragDepth.current += 1; if (!uploading) setDragOver(true) }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = uploading ? 'none' : 'copy' }}
          onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setDragOver(false) }}
          onDrop={(event) => { event.preventDefault(); dragDepth.current = 0; setDragOver(false); if (!uploading) handleDropped(event.dataTransfer?.files) }}
          className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragOver ? 'border-primary bg-primary/10' : 'border-border bg-muted/30 hover:border-primary/50 hover:bg-muted/50'} ${uploading ? 'pointer-events-none opacity-60' : ''}`}
        >
          <Upload className={`h-6 w-6 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">{dragOver ? text.dropRelease : text.dropTitle}</p>
          <p className="text-xs text-muted-foreground">or click to choose it from your computer</p>
        </div>
      )}

      {uploading && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>
      )}

      {notice && (
        <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
          <CheckCircle className="h-4 w-4 shrink-0" /> <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice('')} title="Close" aria-label="Close this message" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition hover:bg-green-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError('')} title="Close" aria-label="Close this message" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition hover:bg-red-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {uploads.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">{text.empty}</p>
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
                    {ai && (() => {
                      const status = aiStatusOf(ai.byDoc.get(String(doc._id)))
                      return (
                        <>
                          <span className={`hidden items-center rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline-flex ${TONE_CLASS[status.tone]}`} data-testid={`ai-chip-${doc._id}`}>{status.text}</span>
                          <button type="button" onClick={() => setAiOpen(doc)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                            <Sparkles className="h-3.5 w-3.5" /> AI Review
                          </button>
                        </>
                      )
                    })()}
                    <button onClick={() => setPreviewDoc(doc)} onMouseEnter={() => prefetchPetition(String(doc._id))} onFocus={() => prefetchPetition(String(doc._id))} className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
                      <Eye className="h-3.5 w-3.5" /> View
                    </button>
                    <button
                      onClick={async () => {
                        const res = await documentsApi.download(doc._id)
                        const url = URL.createObjectURL(res.data)
                        const link = document.createElement('a')
                        link.href = url
                        link.download = doc.originalName || doc.fileName || text.fallbackName
                        link.click()
                        URL.revokeObjectURL(url)
                      }}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" /> Download
                    </button>
                    {canUpload && (
                      <button type="button" onClick={() => { setDeleteError(''); setDeleting(doc) }} className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline" aria-label={`Delete ${doc.originalName || doc.fileName}`}>
                        <Trash2 className="h-3.5 w-3.5" /> Delete
                      </button>
                    )}
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
                {/* why a send button is greyed out - said in plain words instead of only in a hover tooltip */}
                {canUpload && (review.attorneys === 0 || !review.audience) && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {[
                      review.attorneys === 0 ? 'To send to an attorney, first give an attorney access to this case.' : '',
                      !review.audience ? 'To send to the client, the client must first accept their portal invitation and set a password (for an employer case, this is the employer).' : '',
                    ].filter(Boolean).join(' ')}
                  </p>
                )}

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
        <PetitionUploadPreviewModal doc={previewDoc} noun={text.noun} onClose={() => setPreviewDoc(null)} />
      )}
      {confirm && (
        <ConfirmModal
          title={confirm.target === 'attorney' ? 'Send for attorney review?' : 'Send for client review?'}
          message={confirm.target === 'attorney'
            ? (supporting ? 'The attorney(s) on this case will be notified (email, in-app and browser) and will see this document on the case\'s Petition page in the Attorney Portal.' : 'The attorney(s) on this case will be emailed and will see this petition in the Attorney Portal.')
            : (supporting ? `${audienceName} will be notified (email, in-app and browser) and will see this document on the Petition page of the Client Portal.` : `${audienceName} will be emailed and will see this petition on the Petition page of the Client Portal.`)}
          confirmLabel={confirm.target === 'attorney' ? 'Send to attorney' : 'Send to client'}
          onConfirm={() => release(confirm)}
          onCancel={() => setConfirm(null)}
        >
          <div className="mt-4 text-left">
            <label htmlFor="release-note" className="mb-1 block text-xs font-semibold text-muted-foreground">Note (optional)</label>
            <textarea
              id="release-note"
              value={releaseNote}
              onChange={(event) => setReleaseNote(event.target.value.slice(0, 2000))}
              onKeyDown={(event) => event.stopPropagation()}
              rows={3}
              maxLength={2000}
              placeholder={confirm.target === 'attorney' ? 'Add a note for the attorney…' : 'Add a note for the client…'}
              className="input-field w-full resize-y text-sm"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">Shown in the email{confirm.target === 'attorney' ? ' and next to the document in the Attorney Portal' : ''}. Leave it empty to send without a note.</p>
          </div>
        </ConfirmModal>
      )}
      {deleting && (
        <ConfirmModal
          title={`Delete this ${text.noun}?`}
          message={`"${deleting.originalName || deleting.fileName}" will be removed from this case. If it was sent to the client or the attorney, they will no longer see it.`}
          confirmLabel="Delete"
          busy={deleteBusy}
          error={deleteError}
          onConfirm={confirmDelete}
          onCancel={() => { if (!deleteBusy) { setDeleting(null); setDeleteError('') } }}
        />
      )}
      {chat && <PetitionChatModal item={chat} onClose={() => { setChat(null); loadReview() }} onChanged={loadReview} />}
      {aiOpen && (
        <Suspense fallback={null}>
          <PetitionAiReviewPanel
            caseId={caseId}
            documentId={String(aiOpen._id)}
            documentName={aiOpen.originalName || aiOpen.fileName}
            scanId={ai?.byDoc.get(String(aiOpen._id))?.id || ''}
            refreshSignal={aiSignal}
            onClose={() => setAiOpen(null)}
            onChanged={loadAi}
            onOpenPage={(page) => { setPreviewDoc({ ...aiOpen, _page: page }); setAiOpen(null) }}
          />
        </Suspense>
      )}
    </div>
  )
}

// Full-screen petition viewer. The PDF fills the whole screen; the file name, Download and close sit INSIDE the PDF box (a small floating bar over the dark margin beside the
// page, just below the viewer's own toolbar) so no space is spent on a header of our own. The file is streamed into the browser's PDF viewer - page 1 shows while the rest
// loads - and while the server prepares a very large petition we show "Opening…" and keep trying by ourselves: no timeout message. Esc closes.
export function PetitionUploadPreviewModal({ doc, onClose, noun = 'petition' }) {
  const documentId = String(doc._id)
  const { status, url, error, waited, retry } = usePetitionStream(documentId)
  const [painted, setPainted] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const name = doc.originalName || doc.fileName || `${noun}.pdf`

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
      {status === 'ready' && <iframe title="petition-preview" src={doc._page ? `${url}#page=${doc._page}` : url} onLoad={() => setPainted(true)} className="h-full w-full border-0" />}

      {status === 'error' && (
        <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-white">
          <p className="text-sm">{error}</p>
          <button type="button" onClick={retry} className="btn-primary">Try again</button>
        </div>
      )}

      {opening && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-neutral-900 p-6 text-center text-white" role="status" aria-live="polite">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm font-semibold">Opening the {noun}…</p>
          {waited && <p className="max-w-sm text-xs leading-relaxed text-white/70">A large {noun} can take a minute to prepare. It keeps trying automatically - nothing to do.</p>}
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
