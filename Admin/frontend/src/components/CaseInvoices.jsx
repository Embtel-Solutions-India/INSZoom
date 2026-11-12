import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Link2, Loader2, Plus, Receipt, Trash2, X } from 'lucide-react'
import api from '../services/api'

// "Invoices" for one case (internal only - never shown to a client): a popup that lists the invoice LINKS - the "Invoice URL" of the case's GoHighLevel card and any the team adds here. The list and the
// card's field are kept in step both ways: a link added or removed here is written to the card, a change on the card is read back. There are no invoice files and no upload. A link opens in the browser's
// own tab (nothing is stored or proxied). Used by the case's Payment Summary, the employer's employee rows and the Payments page, so all show the same list.
const EMPTY_MESSAGE = 'No invoice URL has been submitted currently.'

const formatWhen = (value) => (value ? new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')
const message = (err, fallback) => err?.response?.data?.message || err?.message || fallback

export default function CaseInvoices({ caseId, title = '', onClose }) {
  const [urls, setUrls] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState('')

  const load = useCallback(async () => {
    try {
      const response = await api.get(`/case-invoices/${caseId}/urls`)
      setUrls(response.data?.data?.urls || [])
      setError('')
    } catch (err) {
      setError(message(err, 'Could not load the invoice URLs'))
    } finally {
      setLoading(false)
    }
  }, [caseId])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const add = async (event) => {
    event?.preventDefault()
    const url = draft.trim()
    if (!url || adding) return
    setAdding(true)
    setError('')
    try {
      const response = await api.post(`/case-invoices/${caseId}/urls`, { url })
      setUrls(response.data?.data?.urls || [])
      setDraft('')
    } catch (err) {
      setError(message(err, 'The invoice URL could not be added'))
    } finally {
      setAdding(false)
    }
  }

  const remove = async (url) => {
    setRemoving(url)
    setError('')
    try {
      const response = await api.delete(`/case-invoices/${caseId}/urls`, { params: { url } })
      setUrls(response.data?.data?.urls || [])
    } catch (err) {
      setError(message(err, 'The invoice URL could not be removed'))
    } finally {
      setRemoving('')
    }
  }

  return createPortal(
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
          <button type="button" onClick={onClose} aria-label="Close" className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-[10rem] flex-1 overflow-y-auto px-5 py-4">
          {error ? <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          {loading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : urls.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-center" data-testid="invoice-empty">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground"><Link2 className="h-6 w-6" /></span>
              <p className="font-medium text-foreground">{EMPTY_MESSAGE}</p>
            </div>
          ) : (
            <ul className="space-y-2" data-testid="invoice-list">
              {urls.map((item) => (
                <li key={item.url} data-testid="invoice-row" className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Link2 className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="block truncate text-sm font-semibold text-primary hover:underline" title={item.url}>{item.url}</a>
                    <p className="text-xs text-muted-foreground">{item.source === 'ghl' ? 'From GoHighLevel' : 'Added here'}{item.addedAt ? ` · ${formatWhen(item.addedAt)}` : ''}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a href={item.url} target="_blank" rel="noopener noreferrer" aria-label="Open invoice link" className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary"><ExternalLink className="h-3.5 w-3.5" />Open</a>
                    <button type="button" onClick={() => remove(item.url)} disabled={removing === item.url} aria-label="Remove invoice URL" className="inline-flex items-center rounded-lg border border-border px-2 py-1.5 text-red-600 hover:bg-red-50 disabled:opacity-60">
                      {removing === item.url ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <form onSubmit={add} className="border-t border-border px-5 py-4">
          <label htmlFor="invoice-url-input" className="mb-1.5 block text-sm font-medium text-foreground">Add invoice URL</label>
          <div className="flex gap-2">
            <input
              id="invoice-url-input"
              type="text"
              inputMode="url"
              autoComplete="off"
              value={draft}
              onChange={(event) => { setDraft(event.target.value); if (error) setError('') }}
              placeholder="Paste the invoice link, e.g. https://…"
              disabled={adding}
              className="input-field min-w-0 flex-1"
              data-testid="invoice-url-input"
            />
            <button type="submit" disabled={adding || !draft.trim()} className="btn-primary inline-flex shrink-0 items-center gap-1.5 disabled:opacity-60">
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  )
}
