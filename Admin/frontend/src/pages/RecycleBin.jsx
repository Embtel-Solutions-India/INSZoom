import { useCallback, useEffect, useState } from 'react'
import { RotateCcw, Trash2 } from 'lucide-react'
import { recycleBinApi, invalidateCachedGet } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import ConfirmModal from '../components/ConfirmModal'

const COUNT_LABELS = [['documents', 'documents'], ['caseforms', 'forms'], ['answers', 'answers'], ['messages', 'messages'], ['tasks', 'tasks']]
const formatDate = (value) => (value ? new Date(value).toLocaleString() : '')

// Deleted cases wait here for 30 days. An administrator can restore one (the case, its employee cases, the client accounts, documents, answers, forms and
// the rest come back as they were); after 30 days the copies and the uploaded files are removed for good.
export default function RecycleBin() {
  const { user } = useAuth()
  const [items, setItems] = useState(null)
  const [retentionDays, setRetentionDays] = useState(30)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, setConfirm] = useState(null) // { item, action: 'restore' | 'purge' }
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await recycleBinApi.list()
      setItems(response.data?.items || [])
      setRetentionDays(response.data?.retentionDays || 30)
      setError('')
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load the recycle bin.')
      setItems((current) => current || [])
    }
  }, [])

  useEffect(() => {
    load()
    // an item still being copied becomes restorable by itself: re-read quietly while any is
    const timer = setInterval(() => load(), 15000)
    return () => clearInterval(timer)
  }, [load])

  const run = async () => {
    if (!confirm) return
    setBusy(true)
    setError('')
    try {
      const response = confirm.action === 'restore' ? await recycleBinApi.restore(confirm.item._id) : await recycleBinApi.purge(confirm.item._id)
      setNotice(response.data?.message || 'Done.')
      invalidateCachedGet('/cases')
      setConfirm(null)
      await load()
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'That did not work. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const summary = (item) => COUNT_LABELS.map(([key, label]) => (item.counts?.[key] ? `${item.counts[key]} ${label}` : null)).filter(Boolean).join(' · ')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Recycle bin</h1>
        <p className="mt-1 text-sm text-muted-foreground">Deleted cases are kept here for {retentionDays} days. Restore one to bring back the case, its employee cases, the client accounts and every record; after {retentionDays} days it is deleted permanently.</p>
      </div>

      {notice && <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-800"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss" className="opacity-70 hover:opacity-100">×</button></div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>}

      <section className="rounded-xl border border-border bg-card">
        <div className="flex items-baseline justify-between border-b border-border px-6 py-4">
          <h3 className="text-sm font-semibold text-foreground">Deleted cases</h3>
          <span className="text-xs tabular-nums text-muted-foreground">{items ? `${items.length} in the bin` : ''}</span>
        </div>
        {items === null ? (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-muted-foreground">The recycle bin is empty.</p>
        ) : (
          <ul className="divide-y divide-border/60" data-testid="recycle-bin-list">
            {items.map((item) => (
              <li key={item._id} className="flex flex-wrap items-center justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {item.caseNumbers.join(', ')}
                    {item.clientNames?.length > 0 && <span className="ml-2 font-normal text-muted-foreground">{item.clientNames.join(', ')}</span>}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Deleted {formatDate(item.deletedAt)}{item.deletedBy ? ` by ${item.deletedBy}` : ''}
                    {summary(item) ? ` · ${summary(item)}` : ''}{item.fileCount ? ` · ${item.fileCount} uploaded file${item.fileCount === 1 ? '' : 's'}` : ''}
                  </p>
                  {item.lastError && <p className="mt-1 text-xs text-red-700">Last restore attempt: {item.lastError}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className={`text-xs tabular-nums ${item.daysLeft <= 3 ? 'font-medium text-red-600' : 'text-muted-foreground'}`}>{item.daysLeft} day{item.daysLeft === 1 ? '' : 's'} left</span>
                  {item.status === 'capturing' ? (
                    <span className="text-xs text-muted-foreground">Saving…</span>
                  ) : (
                    <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs" onClick={() => { setError(''); setConfirm({ item, action: 'restore' }) }}>
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Restore
                    </button>
                  )}
                  {user?.role === 'super_admin' && (
                    <button type="button" className="btn-secondary inline-flex items-center gap-1.5 text-xs text-rose-700" onClick={() => { setError(''); setConfirm({ item, action: 'purge' }) }}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Delete now
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {confirm && (
        <ConfirmModal
          title={confirm.action === 'restore' ? 'Restore this case?' : 'Delete permanently?'}
          message={confirm.action === 'restore'
            ? `${confirm.item.caseNumbers.join(', ')} will be put back exactly as it was, including its client account, documents, forms and messages. Nothing existing is overwritten.`
            : `${confirm.item.caseNumbers.join(', ')} and its uploaded files will be deleted for good now. This cannot be undone.`}
          confirmLabel={busy ? 'Working…' : confirm.action === 'restore' ? 'Yes, restore' : 'Yes, delete permanently'}
          cancelLabel="No"
          tone={confirm.action === 'purge' ? 'danger' : 'default'}
          busy={busy}
          error={error}
          onConfirm={run}
          onCancel={() => { if (!busy) setConfirm(null) }}
        />
      )}
    </div>
  )
}
