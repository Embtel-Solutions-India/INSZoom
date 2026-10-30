import { Link, useOutletContext, useParams } from 'react-router-dom'
import { Briefcase, Scale } from 'lucide-react'
import CaseSlots from '../../../components/CaseSlots'
import { resolveDisplayVisa } from '../../../utils/visaDisplay'

// The case Overview, mirroring Admin's Overview tab card for card (Case Information, Notes, Petitioner & Beneficiary, Filing Readiness, USCIS Tracking, Assigned Staff) with the
// employee / beneficiary slots on top. It reads the same case record Admin edits, and the layout re-reads it on every change pushed for the case, so what the case manager changes
// shows here without a reload. Everything is read-only: the attorney changes nothing here (no stage updates, staff assignment or employee actions).
const STAGE = {
  intake: 'bg-secondary text-foreground',
  strategy: 'bg-blue-100 text-blue-800',
  evidence: 'bg-purple-100 text-purple-800',
  letters: 'bg-pink-100 text-pink-800',
  form_preparation: 'bg-amber-100 text-amber-800',
  filing: 'bg-green-100 text-green-800',
  uscis_pending: 'bg-cyan-100 text-cyan-800',
  approved: 'bg-blue-100 text-blue-800',
  denied: 'bg-red-100 text-red-800',
}
const STATUS = { active: 'bg-green-100 text-green-800', archived: 'bg-secondary text-foreground', closed: 'bg-blue-100 text-blue-800' }
const PRIORITY = { low: 'bg-secondary text-foreground', medium: 'bg-blue-100 text-blue-800', high: 'bg-amber-100 text-amber-800', urgent: 'bg-red-100 text-red-800' }
const PIPELINE = { immigrant: 'Immigrant pipeline', non_immigrant: 'Non-Immigrant pipeline' }

const readinessColor = (score) => (score < 40 ? 'bg-red-500' : score < 70 ? 'bg-amber-500' : 'bg-blue-500')
const money = (value) => {
  const amount = Number(value || 0)
  return amount ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount) : 'Not set'
}
// the notes typed when the case was created (the "Case Details" box)
function creationNotes(caseData) {
  if (caseData.caseNotes) return String(caseData.caseNotes)
  const first = (caseData.internalNotes || [])[0]
  if (!first?.note || !first.createdAt || !caseData.createdAt) return ''
  const gap = Math.abs(new Date(first.createdAt).getTime() - new Date(caseData.createdAt).getTime())
  return gap <= 2 * 60 * 1000 && first.category === 'general' ? String(first.note) : ''
}

function Item({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="font-medium break-words">{children || '—'}</div>
    </div>
  )
}
const Pill = ({ className, children }) => <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${className}`}>{children}</span>

export default function OverviewTab() {
  const { caseData, refreshToken } = useOutletContext()
  const { caseId } = useParams()
  const score = caseData.filingReadinessScore || 0
  const employerMatter = caseData.caseStructure === 'employer_employee' && caseData.caseRole === 'principal'
  const grants = (caseData.attorneyAccess || []).filter((grant) => grant.status === 'active')
  const notes = creationNotes(caseData)
  const packageLabel = caseData.packageName || caseData.plan?.packageName || caseData.plan?.tier || caseData.package || 'Not selected'

  return (
    <div className="space-y-6">
      {caseData.caseRole === 'principal' && <CaseSlots caseId={caseId} structure={caseData.caseStructure} refreshToken={refreshToken} />}

      <div className="card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Case Information</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {employerMatter && <Item label="Company">{caseData.petitionerName || caseData.clientName}</Item>}
          <Item label={employerMatter ? 'Petitioner (Employer) Email' : 'Client Email'}>{caseData.clientEmail || caseData.employeeContact?.email}</Item>
          {employerMatter && caseData.delegateEmployer?.email && (
            <Item label="Delegate Employer">{caseData.delegateEmployer.name ? `${caseData.delegateEmployer.name} · ` : ''}{caseData.delegateEmployer.email}</Item>
          )}
          <Item label="Visa Type">{resolveDisplayVisa(caseData)}</Item>
          {caseData.pipelineCategory && <Item label="GoHighLevel Pipeline">{PIPELINE[caseData.pipelineCategory]}</Item>}
          <Item label="Visa Category">{caseData.visaCategory}</Item>
          <Item label="Package">
            <span className="capitalize">{String(packageLabel).replace('_', ' ')}</span>
            <span className="block text-xs font-normal text-muted-foreground">{money(caseData.plan?.amount || caseData.packageAmount)}</span>
          </Item>
          <Item label="Case Type">{caseData.caseType}</Item>
          <Item label="Filing / Petition Type">{caseData.petitionType}</Item>
          {caseData.caseStructure === 'employer_employee' && <Item label="Employees">{String(caseData.childCaseCount || (caseData.childCases || []).length || 0)}</Item>}
          <Item label="Stage"><Pill className={STAGE[caseData.stage] || STAGE.intake}>{String(caseData.pipelineStage || caseData.stage || '').replace(/_/g, ' ')}</Pill></Item>
          <Item label="Status"><Pill className={STATUS[caseData.status] || 'bg-secondary text-foreground'}>{String(caseData.status || '').replace(/_/g, ' ')}</Pill></Item>
          <Item label="Priority"><Pill className={PRIORITY[caseData.priority] || PRIORITY.low}>{caseData.priority}</Pill></Item>
          <Item label="Created">{caseData.createdAt ? new Date(caseData.createdAt).toLocaleDateString() : ''}</Item>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Notes</h3>
        {notes ? <p className="text-sm text-foreground whitespace-pre-wrap break-words">{notes}</p> : <p className="text-sm text-muted-foreground">No notes were added when the case was created.</p>}
      </div>

      {(caseData.petitionerUser || caseData.beneficiaryUser) && (
        <div className="card">
          <h3 className="text-lg font-semibold text-foreground mb-4">Petitioner &amp; Beneficiary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Petitioner</p>
              <p className="font-medium break-words">{caseData.petitionerUser?.name || caseData.petitionerUser?.displayName || '—'}</p>
              <p className="text-sm text-muted-foreground break-words">{caseData.petitionerUser?.email || '—'}</p>
              {caseData.petitionerUser?.phone && <p className="text-sm text-muted-foreground">{caseData.petitionerUser.phone}</p>}
            </div>
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground">Beneficiary</p>
              <p className="font-medium break-words">{caseData.beneficiaryUser?.name || caseData.beneficiaryUser?.displayName || caseData.clientName || '—'}</p>
              <p className="text-sm text-muted-foreground break-words">{caseData.beneficiaryUser?.email || caseData.clientEmail || '—'}</p>
              {caseData.beneficiaryInvite?.phone && <p className="text-sm text-muted-foreground">{caseData.beneficiaryInvite.phone}</p>}
            </div>
            <Item label="Who's completing the beneficiary section">
              {caseData.familyCompletionMode === 'petitioner_completes' ? 'Petitioner (filling it themselves)' : 'Beneficiary (invited to fill their own)'}
            </Item>
            {caseData.beneficiaryInvite?.status && <Item label="Beneficiary invite status"><span className="capitalize">{caseData.beneficiaryInvite.status}</span></Item>}
          </div>
        </div>
      )}

      <div className="card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Filing Readiness Score</h3>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Overall Score</span>
            <span className="text-2xl font-bold text-foreground">{score}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-3">
            <div className={`h-3 rounded-full transition-all ${readinessColor(score)}`} style={{ width: `${score}%` }} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground">USCIS Tracking</h3>
            <p className="mt-1 text-sm text-muted-foreground break-words">
              {caseData.uscisReceiptNumber ? `Receipt ${caseData.uscisReceiptNumber}` : 'Post-filing tracking begins when this case is filed.'}
            </p>
          </div>
          <Link to={`/cases/${caseId}/tracking`} className="btn-secondary text-sm w-full sm:w-auto shrink-0 text-center">Open Tracking</Link>
        </div>
      </div>

      <div className="card">
        <h3 className="text-lg font-semibold text-foreground mb-4">Assigned Staff</h3>
        <div className="space-y-3">
          <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
            <Briefcase className="w-5 h-5 text-primary shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Case Manager</p>
              <p className="text-sm text-muted-foreground">{caseData.assignedCaseManager?.name || caseData.assignedCaseManager?.displayName || 'Unassigned'}</p>
            </div>
          </div>
          {grants.length > 0 ? grants.map((grant) => (
            <div key={grant._id} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
              <Scale className="w-5 h-5 text-primary shrink-0" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Attorney</p>
                <p className="text-sm text-muted-foreground">{grant.attorneyId?.name || grant.attorneyId?.displayName || grant.attorneyId?.email}</p>
              </div>
            </div>
          )) : (
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
