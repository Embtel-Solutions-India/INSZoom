import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { petitionApi } from '../../services/api'
import PetitionUploadPanel from './PetitionUploadPanel'

const STATUS_BADGE = {
  draft: 'badge-info',
  assembling: 'badge-info',
  assembled: 'badge-success',
  needs_revision: 'badge-warning',
  finalized: 'badge-success',
  filed: 'badge-success',
  superseded: 'badge-info',
  failed: 'badge-danger',
}

// Level 1 (§4): the list of petition versions ever assembled for this case,
// newest first (server already sorts by versionNumber desc), plus the
// "Assemble" action that starts a brand-new version. Opening a row hands off
// to PetitionViewer (Level 2) via onOpen.
export default function PetitionVersionList({ caseId, canAssemble, onOpen }) {
  const [packages, setPackages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await petitionApi.listPackages(caseId)
      setPackages(res.data.data || [])
    } catch (e) {
      setError(e.response?.data?.message || 'Failed to load petition versions')
    } finally {
      setLoading(false)
    }
  }, [caseId])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PetitionUploadPanel caseId={caseId} canUpload={canAssemble} />

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {!packages.length ? null : (
        <div className="card overflow-hidden !p-0">
          <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-sm">
            <thead className="bg-muted text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sections</th>
                <th className="px-4 py-3">Exhibits</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {packages.map((pkg) => (
                <tr key={pkg._id} className="cursor-pointer hover:bg-muted" onClick={() => onOpen(pkg._id)}>
                  <td className="px-4 py-3 font-medium text-foreground">
                    v{pkg.versionNumber}
                    {pkg.isCurrent && <span className="ml-2 text-xs font-normal text-blue-600">current</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATUS_BADGE[pkg.status] || 'badge-info'}`}>{pkg.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{pkg.sections?.length ?? 0}</td>
                  <td className="px-4 py-3 text-muted-foreground">{pkg.exhibitIndex?.length ?? 0}</td>
                  <td className="px-4 py-3 text-muted-foreground">{pkg.updatedAt ? new Date(pkg.updatedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(pkg._id) }} className="btn-secondary !py-1 !px-3 text-xs">
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  )
}
