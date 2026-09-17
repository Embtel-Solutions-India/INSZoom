import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2, Download, Eye } from 'lucide-react'
import { caseDataApi } from '../../../services/api'

const STATUS_TONE = {
  draft: 'badge-neutral',
  assembling: 'badge-info',
  assembled: 'badge-info',
  needs_revision: 'badge-warning',
  finalized: 'badge-success',
  filed: 'badge-success',
  superseded: 'badge-neutral',
  failed: 'badge-danger',
}

// Read-only view of the same petition package versions the case manager's
// Petition tab shows (PetitionVersionList) — no assemble/finalize/unlock
// actions, matching this portal's view + feedback/messages-only scope.
export default function PetitionTab() {
  const { caseId } = useParams()
  const [packages, setPackages] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    caseDataApi
      .petitionPackages(caseId)
      .then(({ data }) => setPackages(data.data || []))
      .catch((err) => setError(err.response?.data?.message || 'Could not load petition packages.'))
  }, [caseId])

  const openBlob = async (fetcher, filename) => {
    try {
      const response = await fetcher()
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      if (filename) link.download = filename
      else link.target = '_blank'
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      setError('That request failed. Please try again.')
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!packages) return <Loader2 className="w-6 h-6 animate-spin text-primary" />
  if (!packages.length) {
    return <p className="text-sm text-muted-foreground card text-center">No petition package has been assembled for this case yet.</p>
  }

  return (
    <div className="card !p-0 divide-y divide-border">
      {packages.map((pkg) => (
        <div key={pkg._id} className="flex items-center justify-between px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Version {pkg.versionNumber}</p>
            <p className="text-xs text-muted-foreground">
              {pkg.packageDefinitionKey}
              {pkg.filing?.receiptNumber ? ` · Receipt ${pkg.filing.receiptNumber}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`badge capitalize ${STATUS_TONE[pkg.status] || 'badge-neutral'}`}>{String(pkg.status || 'unknown').replace(/_/g, ' ')}</span>
            {pkg.outputs?.mailingPdfDocumentId && (
              <>
                <button
                  onClick={() => openBlob(() => caseDataApi.previewPetitionPackage(pkg._id))}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <Eye className="w-3.5 h-3.5" /> Preview
                </button>
                <button
                  onClick={() => openBlob(() => caseDataApi.downloadPetitionPackage(pkg._id), `petition-v${pkg.versionNumber}.pdf`)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                >
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
