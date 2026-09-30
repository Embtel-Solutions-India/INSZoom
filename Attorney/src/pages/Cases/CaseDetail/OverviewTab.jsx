import { useOutletContext } from 'react-router-dom'
import { Briefcase, Scale } from 'lucide-react'

function Field({ label, value }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">{label}</p>
      <p className="text-sm text-foreground">{value || '—'}</p>
    </div>
  )
}

function readinessColor(score) {
  if (score >= 75) return 'bg-green-500'
  if (score >= 40) return 'bg-amber-500'
  return 'bg-red-500'
}

// Mirrors CRMCaseDetail.jsx's own Overview tab fields - the backend already
// sends the full, unfiltered case object to an attorney (serializeCaseForUser
// only redacts for RESTRICTED_PORTAL_ROLES, which attorney is not in), so
// this was purely a frontend under-render, not a data access gap.
export default function OverviewTab() {
  const { caseData } = useOutletContext()
  const score = caseData.filingReadinessScore || 0
  const activeAttorneyGrants = (caseData.attorneyAccess || []).filter((grant) => grant.status === 'active')

  return (
    <div className="space-y-4">
      <div className="card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        <Field label="Case number" value={caseData.caseNumber || caseData.caseId} />
        <Field label="Client" value={caseData.clientName} />
        <Field label="Client email" value={caseData.clientEmail} />
        <Field label="Case type" value={caseData.caseType} />
        <Field label="Visa type" value={caseData.visaType} />
        <Field label="Visa category" value={caseData.visaCategory} />
        <Field label="Petition type" value={caseData.petitionType} />
        <Field label="Stage" value={caseData.stage} />
        <Field label="Status" value={caseData.status} />
        <Field label="Priority" value={caseData.priority} />
        <Field label="Package" value={caseData.plan?.tier || caseData.package} />
        <Field label="Receipt number" value={caseData.uscisReceiptNumber} />
        <Field label="Created" value={caseData.createdAt ? new Date(caseData.createdAt).toLocaleDateString() : ''} />
        <Field label="Last updated" value={caseData.updatedAt ? new Date(caseData.updatedAt).toLocaleDateString() : ''} />
      </div>

      <div className="card">
        <h3 className="text-sm font-bold text-foreground mb-3">Filing Readiness Score</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Overall Score</span>
            <span className="text-xl font-bold text-foreground">{score}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-2.5">
            <div className={`h-2.5 rounded-full transition-all ${readinessColor(score)}`} style={{ width: `${score}%` }} />
          </div>
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-bold text-foreground mb-3">Assigned Staff</h3>
        <div className="space-y-2">
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <Briefcase className="w-5 h-5 text-primary shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground">Case Manager</p>
              <p className="text-sm text-muted-foreground">{caseData.assignedCaseManager?.name || caseData.assignedCaseManager?.displayName || 'Unassigned'}</p>
            </div>
          </div>
          {activeAttorneyGrants.length > 0 ? (
            activeAttorneyGrants.map((grant) => (
              <div key={grant._id} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                <Scale className="w-5 h-5 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">Attorney</p>
                  <p className="text-sm text-muted-foreground">
                    {grant.attorneyId?.name || grant.attorneyId?.displayName || grant.attorneyId?.email}
                  </p>
                </div>
              </div>
            ))
          ) : (
            <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <Scale className="w-5 h-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">Attorney</p>
                <p className="text-sm text-muted-foreground">Unassigned</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
