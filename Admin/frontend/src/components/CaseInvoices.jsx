import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Upload, Eye, Download, X, Loader2, Receipt, FileImage, File as FileIcon, Trash2 } from 'lucide-react'
import api from '../services/api'

// "Invoices" for one case: a popup listing the invoices the team received (internal only - never shown to a client, never in the Documents area), with Add invoice, View and
// Download. View opens the invoice in the portal over the WHOLE screen. Used by the case's Payment Summary and by the Payments page, so both show the same list.
const isImage = (type, name) => /^image\//.test(type || '') || /\.(png|jpe?g|gif|webp)$/i.test(name || '')
const isPdf = (type, name) => /pdf/i.test(type || '') || /\.pdf$/i.test(name || '')
const formatSize = (bytes) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((bytes || 0) / 1024))} KB`)
const formatWhen = (value) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const fileUrl = (caseId, invoice, download) => `/case-invoices/${caseId}/${invoice._id}/file${download ? '?download=1' : ''}`

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

function Viewer({ caseId, invoice, onClose, onDownload }) {
  const [state, setState] = useState({ url: '', error: '' })
  useEffect(() => {
    let revoked = false
    let objectUrl = ''
    api.get(fileUrl(caseId, invoice), { responseType: 'blob' })
      .then((response) => {
        if (revoked) return
        const type = response.data.type || invoice.mimeType
        objectUrl = URL.createObjectURL(response.data.type ? response.data : new Blob([response.data], { type }))
        setState({ url: objectUrl, error: '' })
      })
      .catch(() => { if (!revoked) setState({ url: '', error: 'This invoice could not be opened.' }) })
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { revoked = true; window.removeEventListener('keydown', onKey); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [caseId, invoice, onClose])

  const previewable = isPdf(invoice.mimeType, invoice.fileName) || isImage(invoice.mimeType, invoice.fileName)
  return (
    <div className="fixed inset-0 z-[80] flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={`Invoice ${invoice.fileName}`} data-testid="invoice-viewer">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Receipt className="h-5 w-5 shrink-0 text-primary" />
          <p className="truncate font-semibold text-foreground">{invoice.fileName}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onDownload} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-secondary"><Download className="h-4 w-4" /> Download</button>
          <button type="button" onClick={onClose} aria-label="Close invoice" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-muted">
        {state.error ? (
          <div className="flex h-full items-center justify-center text-sm text-red-700">{state.error}</div>
        ) : !state.url ? (
          <div className="flex h-full items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : !previewable ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <FileIcon className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">This file type cannot be previewed here.</p>
            <button type="button" onClick={onDownload} className="btn-primary inline-flex items-center gap-2"><Download className="h-4 w-4" /> Download</button>
          </div>
        ) : isImage(invoice.mimeType, invoice.fileName) ? (
          <div className="flex h-full items-center justify-center overflow-auto p-2"><img src={state.url} alt={invoice.fileName} className="max-h-full max-w-full object-contain" /></div>
        ) : (
          <iframe title={invoice.fileName} src={state.url} className="h-full w-full border-0 bg-white" />
        )}
      </div>
    </div>
  )
}

export default function CaseInvoices({ caseId, title, onClose }) {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [confirming, setConfirming] = useState(null) // the invoice waiting for "Delete" to be confirmed
  const [deleting, setDeleting] = useState(false)
  const fileInput = useRef(null)

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/case-invoices/${caseId}`)
      setInvoices(response.data.data || [])
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the invoices')
    } finally {
      setLoading(false)
    }
  }, [caseId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !viewing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, viewing])

  const upload = async (event) => {
    const files = Array.from(event.target.files || [])
    event.target.value = ''
    if (!files.length) return
    setUploading(true)
    setError('')
    try {
      for (const file of files) {
        const form = new FormData()
        form.append('file', file)
        await api.post(`/case-invoices/${caseId}`, form, { headers: { 'Content-Type': 'multipart/form-data' } })
      }
      await load()
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Upload failed')
      await load()
    } finally {
      setUploading(false)
    }
  }

  const download = async (invoice) => {
    try {
      const response = await api.get(fileUrl(caseId, invoice, true), { responseType: 'blob' })
      saveBlob(response.data, invoice.fileName)
    } catch {
      setError('This invoice could not be downloaded.')
    }
  }

  const remove = async () => {
    if (!confirming) return
    setDeleting(true)
    try {
      await api.delete(`/case-invoices/${caseId}/${confirming._id}`)
      setInvoices((list) => list.filter((entry) => entry._id !== confirming._id))
      setConfirming(null)
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'The invoice could not be deleted')
      setConfirming(null)
    } finally {
      setDeleting(false)
    }
  }

  return createPortal(
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-card shadow-xl" role="dialog" aria-modal="true" aria-label="Invoices" data-testid="invoices-modal" onClick={(event) => event.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Receipt className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-foreground">Invoices</h3>
                {title ? <p className="truncate text-sm text-muted-foreground">{title}</p> : null}
                <p className="text-xs text-muted-foreground">Internal only. Clients never see these.</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <input ref={fileInput} type="file" multiple className="hidden" onChange={upload} data-testid="invoice-file-input" />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={uploading} className="btn-primary inline-flex items-center gap-2 disabled:opacity-60">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Add invoice
              </button>
              <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-5 w-5" /></button>
            </div>
          </div>

          <div className="min-h-[12rem] flex-1 overflow-y-auto px-5 py-4">
            {error ? <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            {loading ? (
              <div className="flex h-40 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : invoices.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground"><FileText className="h-6 w-6" /></span>
                <p className="font-medium text-foreground">No invoices yet</p>
                <p className="text-sm text-muted-foreground">Use Add invoice to upload the first one.</p>
              </div>
            ) : (
              <ul className="space-y-2" data-testid="invoice-list">
                {invoices.map((invoice) => (
                  <li key={invoice._id} data-testid="invoice-row" className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      {isImage(invoice.mimeType, invoice.fileName) ? <FileImage className="h-5 w-5" /> : <FileText className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-foreground" title={invoice.fileName}>{invoice.fileName}</p>
                      <p className="truncate text-xs text-muted-foreground">{formatSize(invoice.size)} · {formatWhen(invoice.createdAt)}{invoice.uploadedBy?.name ? ` · ${invoice.uploadedBy.name}` : ''}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button type="button" onClick={() => setViewing(invoice)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"><Eye className="h-3.5 w-3.5" /> View</button>
                      <button type="button" onClick={() => download(invoice)} aria-label={`Download ${invoice.fileName}`} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"><Download className="h-3.5 w-3.5" /> Download</button>
                      <button type="button" onClick={() => setConfirming(invoice)} aria-label={`Delete ${invoice.fileName}`} className="inline-flex items-center rounded-lg border border-border px-2 py-1.5 text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      {confirming ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4" onClick={() => !deleting && setConfirming(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-card p-5 shadow-xl" role="alertdialog" aria-modal="true" aria-label="Delete invoice" data-testid="invoice-delete-confirm" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600"><Trash2 className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h4 className="font-semibold text-foreground">Delete this invoice?</h4>
                <p className="mt-1 break-words text-sm text-muted-foreground">{confirming.fileName} will be removed permanently. This cannot be undone.</p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(null)} disabled={deleting} className="btn-secondary">Cancel</button>
              <button type="button" onClick={remove} disabled={deleting} className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {viewing ? <Viewer caseId={caseId} invoice={viewing} onClose={() => setViewing(null)} onDownload={() => download(viewing)} /> : null}
    </>,
    document.body
  )
}
