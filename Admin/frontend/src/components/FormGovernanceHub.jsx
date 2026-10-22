import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import FormGovernanceOverviewSection from './FormGovernanceOverviewSection'
import FormStatusPanel from './FormStatusPanel'
import MappingReviewQueueSection from './MappingReviewQueueSection'
import FrozenCasesSection from './FrozenCasesSection'
import AiMappingSection from './AiMappingSection'
import { READ_ROLES } from './governanceShared'

// Phase 5 operations hub: one place, five read-only views. Same roles as the governance API (super_admin, admin, team_lead).
const TABS = [
  ['overview', 'Overview'],
  ['status', 'Form status'],
  ['review', 'Mapping review'],
  ['frozen', 'Older editions in cases'],
  ['ai', 'AI mapping'],
]

const FormGovernanceHub = ({ forms = [] }) => {
  const { user } = useAuth()
  const [tab, setTab] = useState('overview')
  if (!READ_ROLES.includes(user?.role)) return null

  return (
    <div className="space-y-4" data-testid="governance-hub">
      <div role="tablist" aria-label="Form operations" className="flex flex-wrap gap-1.5">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${tab === id ? 'border-primary-600 bg-primary-600 text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'}`}>{label}</button>
        ))}
      </div>
      {tab === 'overview' && <FormGovernanceOverviewSection />}
      {tab !== 'overview' && (
        <div className="card">
          {tab === 'status' && <FormStatusPanel forms={forms} />}
          {tab === 'review' && <MappingReviewQueueSection />}
          {tab === 'frozen' && <FrozenCasesSection />}
          {tab === 'ai' && <AiMappingSection forms={forms} />}
        </div>
      )}
    </div>
  )
}

export default FormGovernanceHub
