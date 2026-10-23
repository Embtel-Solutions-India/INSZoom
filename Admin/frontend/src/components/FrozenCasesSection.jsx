import { useCallback, useEffect, useState } from 'react'
import { governanceOpsApi } from '../services/api'
import { Badge, unwrap, errorMessage, when, words } from './governanceShared'

// Phase 5 frozen case forms (read-only): case forms that are finished, approved or filed stay on the edition they were made with, even after a newer edition went live. They are
// never moved automatically; this list is what an admin reconciles by hand, with the ones that matter most (the old edition is no longer accepted) first.
const FrozenCasesSection = () => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setData(unwrap(await governanceOpsApi.frozenCases()))
      setError('')
    } catch (err) {
      setError(errorMessage(err, 'Could not load the case forms on older editions.'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const items = [...(data?.items || [])].sort((a, b) => Number(Boolean(b.priority)) - Number(Boolean(a.priority)))

  return (
    <div className="space-y-3" data-testid="frozen-cases">
      <p className="text-sm text-muted-foreground">Case forms that stay on an older edition because they are approved, locked or filed. Nothing here is changed automatically. Those marked <strong>Check first</strong> are on an edition USCIS no longer accepts.</p>
      {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && <div role="alert" className="text-sm rounded-lg border border-red-300 text-red-700 px-3 py-2">{error}</div>}
      {!loading && !error && items.length === 0 ? <p className="text-sm text-muted-foreground">No case forms are waiting on an older edition.</p> : (
        <ul className="divide-y divide-border/60 rounded-lg border border-border" data-testid="frozen-list">
          {items.map((item) => (
            <li key={item.caseFormId} className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
              <div className="space-y-0.5">
                <div className="flex flex-wrap items-center gap-2"><strong>{item.caseNumber || 'Case'}</strong> <span className="text-muted-foreground">{item.formCode}</span> {item.priority ? <Badge tone="red">Check first</Badge> : null} <Badge tone="gray">{words(item.status)}</Badge></div>
                <p className="text-xs text-muted-foreground">On edition {item.fromEdition || '-'}{item.toEdition ? `; the live edition is ${item.toEdition}` : ''}{item.reportedAt ? ` · noted ${when(item.reportedAt)}` : ''}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default FrozenCasesSection
