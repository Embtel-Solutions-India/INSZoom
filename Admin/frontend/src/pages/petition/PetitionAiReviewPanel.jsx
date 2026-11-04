import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Loader2, RefreshCw, Sparkles, AlertTriangle, FileSearch } from 'lucide-react'
import { petitionAiReviewApi } from '../../services/api'
import ConfirmModal from '../../components/ConfirmModal'
import { aiStatusOf, TONE_CLASS, SEVERITY_LABEL, CATEGORY_LABEL, OPEN_STATUSES } from './petitionAiStatus'

// The AI Review of one petition (Petition AI Review, Phase 5). Loaded only when opened (React.lazy in PetitionUploadPanel), so the petition page
// itself stays as fast as before. Shows the summary and severity counts, the findings grouped by page with filters, "Open page N" (the
// existing viewer at that page), and Re-scan / Retry / Cancel. Every finding is AI-assisted: the panel says so. `refreshSignal` changes when a
// live "petition:ai_review" event arrives for this petition, and the panel re-reads.
const SEVERITY_ORDER = ['error', 'warning', 'info']
const SEVERITY_DOT = { error: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-slate-400' }
const PAGE_SIZE = 50

// The summary as the owner asked for it (2026-11-04): one bullet per page in page order; one issue sits on the page's line, two or more
// become sub-points; each names the section of the page. Built in code on the server (summary.points), so it is exact and complete.
function SummaryPoints({ summary, counts = {}, onOpenPage }) {
  const total = (counts.error || 0) + (counts.warning || 0) + (counts.info || 0)
  const line = (item) => (
    <>
      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${SEVERITY_DOT[item.severity] || 'bg-slate-400'}`} />
      {item.section && <span className="font-semibold">{item.section}: </span>}
      {item.text}
      <span className="ml-1 text-xs text-muted-foreground">({SEVERITY_LABEL[item.severity] || item.severity})</span>
    </>
  )
  return (
    <div className="max-h-72 overflow-y-auto rounded-lg bg-muted/60 p-3 text-sm leading-6 text-foreground" data-testid="ai-summary-points">
      <p className="mb-1 font-semibold">{total} issue{total === 1 ? '' : 's'} on {summary.points.length} page{summary.points.length === 1 ? '' : 's'}: {counts.error || 0} to fix, {counts.warning || 0} to check, {counts.info || 0} minor.</p>
      <ul className="list-disc space-y-1 pl-5">
        {summary.points.map((point) => (
          <li key={point.page}>
            <button type="button" className="font-semibold text-primary hover:underline" onClick={() => onOpenPage?.(point.page)}>Page {point.page}</button>
            {point.items.length === 1 ? <> - {line(point.items[0])}</> : (
              <ul className="list-[circle] space-y-0.5 pl-5">
                {point.items.map((item, index) => <li key={index}>{line(item)}</li>)}
              </ul>
            )}
          </li>
        ))}
        {summary.more > 0 && <li>... and {summary.more} more issue{summary.more === 1 ? '' : 's'} in the list below.</li>}
      </ul>
    </div>
  )
}

export default function PetitionAiReviewPanel({ caseId, documentId, documentName, scanId: initialScanId, refreshSignal, onClose, onOpenPage, onChanged }) {
  const [scanId, setScanId] = useState(initialScanId || '')
  const [scan, setScan] = useState(null)
  const [findings, setFindings] = useState([])
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 })
  const [severity, setSeverity] = useState('')
  const [category, setCategory] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('') // rescan | retry | cancel
  const [confirm, setConfirm] = useState('') // rescan | cancel

  const loadFindings = useCallback(async (id, page = 1, append = false) => {
    const res = await petitionAiReviewApi.findings(id, { page, limit: PAGE_SIZE, ...(severity ? { severity } : {}), ...(category ? { category } : {}) })
    const data = res.data?.data || {}
    setFindings((current) => (append ? [...current, ...(data.findings || [])] : data.findings || []))
    setPagination(data.pagination || { page, pages: 1, total: 0 })
  }, [severity, category])

  const load = useCallback(async () => {
    if (!scanId) { setLoading(false); return }
    try {
      const res = await petitionAiReviewApi.getScan(scanId)
      setScan(res.data?.data || null)
      await loadFindings(scanId, 1, false)
      setError('')
    } catch (err) {
      setError(err?.response?.data?.message || 'The AI review could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [scanId, loadFindings])

  useEffect(() => { load() }, [load, refreshSignal])

  useEffect(() => {
    const onKey = (event) => { if (event.key === 'Escape' && !confirm) onClose?.() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, confirm])

  const act = async (kind) => {
    setConfirm('')
    setBusy(kind)
    setError('')
    try {
      if (kind === 'rescan') {
        const res = await petitionAiReviewApi.rescan(caseId, documentId)
        const next = res.data?.data?.scan
        if (next?.id) setScanId(next.id)
      } else if (kind === 'retry') {
        await petitionAiReviewApi.retry(scanId)
      } else if (kind === 'cancel') {
        await petitionAiReviewApi.cancel(scanId)
      }
      await load()
      onChanged?.()
    } catch (err) {
      setError(err?.response?.data?.message || 'That did not work. Please try again.')
    } finally {
      setBusy('')
    }
  }

  const byPage = useMemo(() => {
    const groups = new Map()
    for (const finding of findings) {
      if (!groups.has(finding.page)) groups.set(finding.page, [])
      groups.get(finding.page).push(finding)
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0])
  }, [findings])

  const status = aiStatusOf(scan)
  const open = scan && OPEN_STATUSES.includes(scan.status)
  const canRetry = scan && (['failed', 'cancelled'].includes(scan.status) || (scan.status === 'queued' && (scan.paused || scan.nextAttemptAt)))
  const failedBatches = (scan?.diagnostics || []).filter((d) => d.outcome && !['OK', 'DROPPED'].includes(d.outcome))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/45 px-4 py-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !confirm) onClose?.() }}>
      <div role="dialog" aria-modal="true" aria-label={`AI review of ${documentName || 'the petition'}`} className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-lg font-bold text-foreground"><Sparkles className="h-5 w-5 text-primary" /> AI Review</h2>
            <p className="truncate text-sm text-muted-foreground">{documentName}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close the AI review" className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {loading && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading...</p>}

          {!loading && !scanId && (
            <div className="text-center">
              <FileSearch className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">This petition has not been scanned yet.</p>
            </div>
          )}

          {!loading && scan && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[status.tone]}`} data-testid="ai-status">
                  {open && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {status.text}
                </span>
                {SEVERITY_ORDER.map((key) => (
                  <span key={key} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
                    <span className={`h-2 w-2 rounded-full ${SEVERITY_DOT[key]}`} /> {scan.counts?.[key] || 0} {SEVERITY_LABEL[key]}
                  </span>
                ))}
              </div>

              {scan.summary?.points?.length > 0 ? (
                <SummaryPoints summary={scan.summary} counts={scan.counts} onOpenPage={onOpenPage} />
              ) : (
                scan.summary?.text && <p className="whitespace-pre-line rounded-lg bg-muted/60 p-3 text-sm leading-6 text-foreground">{scan.summary.text}</p>
              )}
              {(scan.paused?.message || scan.error?.message) && (
                <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {scan.paused?.message || scan.error?.message}</p>
              )}
              {failedBatches.length > 0 && (
                <p className="text-xs text-muted-foreground" data-testid="ai-diagnostics">
                  {failedBatches.length} AI call{failedBatches.length === 1 ? '' : 's'} needed a retry or fallback (latest: pages {failedBatches.at(-1).from}-{failedBatches.at(-1).to}, {failedBatches.at(-1).outcome}).
                </p>
              )}

              {scan.usage?.calls > 0 && (
                <p className="text-xs text-muted-foreground" data-testid="ai-usage">
                  AI use: {scan.usage.calls} call{scan.usage.calls === 1 ? '' : 's'} · {Number(scan.usage.tokens || 0).toLocaleString('en-US')} tokens
                  {scan.usage.costUsd != null && <> · about ${Number(scan.usage.costUsd).toFixed(2)}</>}
                  {scan.modelVersion && <> · {scan.modelVersion}</>}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <select className="input-field !w-auto text-xs" value={severity} onChange={(event) => setSeverity(event.target.value)} aria-label="Filter by severity">
                  <option value="">All severities</option>
                  {SEVERITY_ORDER.map((key) => <option key={key} value={key}>{SEVERITY_LABEL[key]}</option>)}
                </select>
                <select className="input-field !w-auto text-xs" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by kind">
                  <option value="">All kinds</option>
                  {Object.entries(CATEGORY_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
                <span className="text-xs text-muted-foreground">{pagination.total} finding{pagination.total === 1 ? '' : 's'}</span>
              </div>

              {byPage.length === 0 && <p className="text-sm text-muted-foreground">{open ? 'Findings appear here as the pages are read.' : 'No findings for this filter.'}</p>}
              <div className="space-y-3">
                {byPage.map(([page, items]) => (
                  <section key={page} className="rounded-lg border border-border p-3" aria-label={`Page ${page}`}>
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-foreground">Page {page}</h3>
                      <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => onOpenPage?.(page)}>Open page {page}</button>
                    </div>
                    <ul className="space-y-2">
                      {items.map((finding) => (
                        <li key={finding.id} className="text-sm">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${SEVERITY_DOT[finding.severity] || 'bg-slate-400'}`} />
                            <span className="font-semibold text-foreground">{CATEGORY_LABEL[finding.category] || finding.category}</span>
                            {finding.section && <span className="text-xs text-foreground/80">· {finding.section}</span>}
                            <span className="text-xs text-muted-foreground">{SEVERITY_LABEL[finding.severity] || finding.severity}</span>
                          </p>
                          {finding.excerpt && <p className="mt-0.5 text-xs italic text-muted-foreground">"{finding.excerpt}"</p>}
                          {finding.found && <p className="text-foreground">{finding.found}</p>}
                          {finding.suggestion && <p className="text-xs text-foreground/80">Suggested: {finding.suggestion}</p>}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              {pagination.page < pagination.pages && (
                <button type="button" className="btn-secondary w-full justify-center text-sm" onClick={() => loadFindings(scanId, pagination.page + 1, true)}>Show more findings</button>
              )}
            </>
          )}

          {error && <p className="text-sm font-medium text-red-600" role="alert">{error}</p>}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border p-4">
          <p className="text-xs font-semibold text-muted-foreground">AI-assisted - verify before acting.</p>
          <div className="flex flex-wrap gap-2">
            {open && <button type="button" className="btn-secondary text-sm" disabled={Boolean(busy)} onClick={() => setConfirm('cancel')}>{busy === 'cancel' ? 'Cancelling...' : 'Cancel scan'}</button>}
            {canRetry && <button type="button" className="btn-secondary text-sm" disabled={Boolean(busy)} onClick={() => act('retry')}>{busy === 'retry' ? 'Retrying...' : 'Retry now'}</button>}
            {!open && <button type="button" className="btn-primary inline-flex items-center gap-1.5 text-sm" disabled={Boolean(busy)} onClick={() => setConfirm('rescan')}><RefreshCw className="h-4 w-4" /> {busy === 'rescan' ? 'Starting...' : scanId ? 'Re-scan' : 'Scan now'}</button>}
          </div>
        </div>
      </div>

      {confirm && (
        <ConfirmModal
          title={confirm === 'rescan' ? 'Scan this petition again?' : 'Stop this AI review?'}
          message={confirm === 'rescan'
            ? 'A fresh AI review reads every page again from page 1. It runs in the background and uses AI credits.'
            : 'The scan stops where it is. You can start it again later with Retry or Re-scan.'}
          confirmLabel={confirm === 'rescan' ? 'Scan again' : 'Stop scan'}
          icon={confirm === 'rescan' ? RefreshCw : AlertTriangle}
          onConfirm={() => act(confirm)}
          onCancel={() => setConfirm('')}
        />
      )}
    </div>
  )
}
