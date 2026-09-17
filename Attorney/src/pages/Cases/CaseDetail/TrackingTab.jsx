import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { caseDataApi } from '../../../services/api'

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{value || '—'}</p>
    </div>
  )
}

function dateOf(value) {
  return value ? new Date(value).toLocaleDateString() : ''
}

// Read-only version of CRMCaseDetail's USCIS Tracking tab (which is fully
// editable there) — same lifecycleApi.tracking() data, no save action.
export default function TrackingTab() {
  const { caseId } = useParams()
  const [tracking, setTracking] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    caseDataApi
      .tracking(caseId)
      .then(({ data }) => setTracking(data.tracking || {}))
      .catch((err) => setError(err.response?.data?.message || 'Could not load USCIS tracking.'))
  }, [caseId])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!tracking) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  const filing = tracking.filing || {}
  const rfe = tracking.rfe || {}

  return (
    <div className="space-y-4">
      <div className="card">
        <h3 className="text-lg font-semibold text-foreground mb-1">Current Status</h3>
        <p className="text-sm text-foreground capitalize">{String(tracking.status || 'draft').replace(/_/g, ' ')}</p>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Filing Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Field label="Filing Date" value={dateOf(filing.filingDate)} />
          <Field label="USCIS Receipt Number" value={filing.receiptNumber} />
          <Field label="Service Center" value={filing.serviceCenter} />
          <Field label="Filing Method" value={filing.filingMethod} />
          <Field label="Shipping Carrier" value={filing.carrier} />
          <Field label="Tracking Number" value={filing.trackingNumber} />
          <Field label="Delivery Confirmation" value={dateOf(filing.deliveryConfirmationDate)} />
          <Field label="Premium Processing" value={filing.premiumProcessing ? 'Yes' : 'No'} />
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-foreground mb-4">RFE Management</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Field label="RFE Issue Date" value={dateOf(rfe.issueDate)} />
          <Field label="Response Due Date" value={dateOf(rfe.responseDueDate)} />
          <Field label="Response Submitted Date" value={dateOf(rfe.responseSubmittedDate)} />
          <Field label="Response Status" value={rfe.responseStatus} />
        </div>
      </div>
    </div>
  )
}
