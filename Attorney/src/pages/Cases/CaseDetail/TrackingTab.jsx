import { useEffect, useState } from 'react'
import { useOutletContext, useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { attorneyApi } from '../../../services/api'

// The USCIS Tracking tab, mirroring Admin's tab section for section (Current USCIS Status, Filing Information, RFE Management, USCIS Documents, Case Timeline, Tracking Notes) but
// read-only. It reads the very record Admin saves, and the case page re-reads it the moment Admin saves (a live "tracking" signal), so changes there appear here without a reload.
const display = (value) => String(value || '').replace(/_/g, ' ')
const dateOf = (value) => (value ? new Date(value).toLocaleDateString() : '')
const money = (cents) => (Number(cents) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(cents) / 100) : '')

function Field({ label, value, wide }) {
  return (
    <div className={`min-w-0 ${wide ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm text-foreground break-words whitespace-pre-wrap">{value || '—'}</p>
    </div>
  )
}

export default function TrackingTab() {
  const { caseId } = useParams()
  const { refreshToken } = useOutletContext()
  const [state, setState] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    attorneyApi
      .tracking(caseId)
      .then(({ data }) => { setState(data.data); setError('') })
      .catch((err) => setError(err.response?.data?.message || 'Could not load USCIS tracking.'))
  }, [caseId, refreshToken])

  if (error && !state) return <p className="text-sm text-destructive">{error}</p>
  if (!state) return <Loader2 className="w-6 h-6 animate-spin text-primary" />

  const tracking = state.tracking || {}
  const filing = tracking.filing || {}
  const rfe = tracking.rfe || {}
  const documents = state.governmentDocuments || []
  const timeline = state.timeline || []

  return (
    <div className="space-y-6">
      <div className="card">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700 dark:text-blue-300">Post-Filing Case Monitoring</p>
        <h3 className="mt-1 text-xl font-semibold text-foreground">USCIS Tracking</h3>
        <p className="mt-1 text-sm text-muted-foreground">Government processing details remain separate from case-preparation workflow.</p>
        <div className="mt-4"><Field label="Current USCIS Status" value={<span className="capitalize">{display(tracking.status || 'draft')}</span>} /></div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Filing Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Field label="Filing Date" value={dateOf(filing.filingDate)} />
          <Field label="USCIS Receipt Number" value={filing.receiptNumber} />
          <Field label="Service Center" value={filing.serviceCenter} />
          <Field label="USCIS Lockbox" value={filing.lockbox} />
          <Field label="Filing Method" value={display(filing.filingMethod)} />
          <Field label="Shipping Carrier" value={filing.carrier} />
          <Field label="Shipment Tracking Number" value={filing.trackingNumber} />
          <Field label="Delivery Confirmation" value={dateOf(filing.deliveryConfirmationDate)} />
          <Field label="Filing Fee" value={money(filing.filingFeeCents)} />
          <Field label="Premium Processing" value={filing.premiumProcessing ? 'Yes' : 'No'} />
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-foreground mb-4">RFE Management</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <Field label="RFE Issue Date" value={dateOf(rfe.issueDate)} />
          <Field label="Response Due Date" value={dateOf(rfe.responseDueDate)} />
          <Field label="Response Submitted Date" value={dateOf(rfe.responseSubmittedDate)} />
          <Field label="Response Status" value={display(rfe.responseStatus)} />
          <Field label="AI-Generated RFE Summary" value={rfe.aiSummary} wide />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <div className="card">
          <h3 className="text-lg font-semibold text-foreground">USCIS Documents</h3>
          <p className="mt-1 text-sm text-muted-foreground">Receipt, approval, biometrics, interview, RFE, and transfer notices attach automatically after classification.</p>
          <div className="mt-4 space-y-3">
            {documents.length ? documents.map((document) => (
              <div key={document._id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{document.originalName}</p>
                  <p className="text-xs text-muted-foreground capitalize">{display(document.documentType)} · {dateOf(document.createdAt)}</p>
                </div>
                <span className="badge badge-info capitalize shrink-0">{display(document.reviewStatus) || 'pending'}</span>
              </div>
            )) : <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No USCIS notices have been classified for this case yet.</p>}
          </div>
        </div>

        <div className="card">
          <h3 className="text-lg font-semibold text-foreground">Case Timeline</h3>
          <p className="mt-1 text-sm text-muted-foreground">Questionnaire, filing, receipt, RFE, interview, and decision events.</p>
          <div className="mt-4 max-h-96 space-y-4 overflow-y-auto pr-2">
            {timeline.length ? timeline.map((event, index) => (
              <div key={event._id || `${event.type}-${index}`} className="relative border-l-2 border-blue-200 pl-4">
                <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-blue-500" />
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">{dateOf(event.createdAt || event.occurredAt)}</p>
                <p className="text-sm font-semibold text-foreground">{event.title || display(event.type)}</p>
                {event.description && <p className="text-xs text-muted-foreground">{event.description}</p>}
              </div>
            )) : <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">No timeline activity recorded yet.</p>}
          </div>
        </div>
      </div>

      {tracking.notes && (
        <div className="card">
          <Field label="Tracking Notes" value={tracking.notes} />
        </div>
      )}
    </div>
  )
}
