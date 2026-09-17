import { useOutletContext } from 'react-router-dom'

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{value || '—'}</p>
    </div>
  )
}

export default function OverviewTab() {
  const { caseData } = useOutletContext()
  return (
    <div className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      <Field label="Case number" value={caseData.caseNumber || caseData.caseId} />
      <Field label="Client" value={caseData.clientName} />
      <Field label="Client email" value={caseData.clientEmail} />
      <Field label="Visa type" value={caseData.visaType} />
      <Field label="Visa category" value={caseData.visaCategory} />
      <Field label="Stage" value={caseData.stage} />
      <Field label="Status" value={caseData.status} />
      <Field label="Priority" value={caseData.priority} />
      <Field label="Receipt number" value={caseData.uscisReceiptNumber} />
      <Field label="Created" value={caseData.createdAt ? new Date(caseData.createdAt).toLocaleDateString() : ''} />
      <Field label="Last updated" value={caseData.updatedAt ? new Date(caseData.updatedAt).toLocaleDateString() : ''} />
    </div>
  )
}
