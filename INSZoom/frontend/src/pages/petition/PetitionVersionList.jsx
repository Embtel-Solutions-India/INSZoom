import { useCallback, useEffect, useState } from 'react'
import { FileStack, Sparkles, Loader2, AlertCircle } from 'lucide-react'
import { petitionApi } from '../../services/api'

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
  const [assembling, setAssembling] = useState(false)
  const [assembleError, setAssembleError] = useState('')

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

  const handleAssemble = async () => {
    setAssembling(true)
    setAssembleError('')
    try {
      const res = await petitionApi.assemble(caseId, {})
      await load()
      onOpen(res.data.data._id)
    } catch (e) {
      setAssembleError(e.response?.data?.message || 'Failed to assemble petition — check that a package definition exists for this case\'s visa type.')
    } finally {
      setAssembling(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Petition</h3>
          <p className="text-sm text-gray-500">Assemble, review, and file the petition package for this case.</p>
        </div>
        {canAssemble && (
          <button type="button" onClick={handleAssemble} disabled={assembling} className="btn-primary inline-flex items-center gap-2">
            {assembling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {packages.length ? 'Assemble New Version' : 'Assemble Petition'}
          </button>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}
      {assembleError && (
        <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {assembleError}
        </div>
      )}

      {!packages.length && !error ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-center">
          <FileStack className="h-10 w-10 text-gray-300" />
          <p className="text-sm text-gray-500">No petition has been assembled for this case yet.</p>
        </div>
      ) : (
        <div className="card overflow-hidden !p-0">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sections</th>
                <th className="px-4 py-3">Exhibits</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {packages.map((pkg) => (
                <tr key={pkg._id} className="cursor-pointer hover:bg-gray-50" onClick={() => onOpen(pkg._id)}>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    v{pkg.versionNumber}
                    {pkg.isCurrent && <span className="ml-2 text-xs font-normal text-blue-600">current</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${STATUS_BADGE[pkg.status] || 'badge-info'}`}>{pkg.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{pkg.sections?.length ?? 0}</td>
                  <td className="px-4 py-3 text-gray-600">{pkg.exhibitIndex?.length ?? 0}</td>
                  <td className="px-4 py-3 text-gray-500">{pkg.updatedAt ? new Date(pkg.updatedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(pkg._id) }} className="btn-secondary !py-1 !px-3 text-xs">
                      Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
