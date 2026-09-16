import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import InfoModal from '../components/InfoModal'
import CategoryPage from '../components/settings/CategoryPage'
import FirmMembersPanel from '../components/settings/FirmMembersPanel'
import TeamsPanel from '../components/settings/TeamsPanel'
import BranchesPanel from '../components/settings/BranchesPanel'
import EmailTemplatesPanel from '../components/settings/EmailTemplatesPanel'
import SavedChargesPanel from '../components/settings/SavedChargesPanel'
import LockedUsersPanel from '../components/settings/LockedUsersPanel'
import {
  Building2,
  Users,
  Globe,
  Bell,
  ClipboardList,
  Mail,
  DollarSign,
  Shield,
  Brain,
  Trash2
} from 'lucide-react'

// Left-rail category nav — replaces the old horizontal 4-tab strip. Every
// category except 'users' (Firm Members/Teams/Branches are real CRUD
// resources, not settings values) and 'ai' (relocated verbatim, unchanged,
// per this pass's own decision to not rebuild it) is rendered by the one
// generic, schema-driven <CategoryPage> — see its own file for why.
const NAV = [
  { id: 'firm', label: 'Firm Profile', icon: Building2, roles: ['admin', 'super_admin'] },
  { id: 'users', label: 'Users & Permissions', icon: Users, roles: ['admin', 'super_admin'] },
  { id: 'portal', label: 'Client Portal', icon: Globe, roles: ['admin', 'super_admin'] },
  { id: 'notifications', label: 'Notifications', icon: Bell, roles: ['admin', 'super_admin'] },
  { id: 'intake', label: 'Questionnaires & Intake', icon: ClipboardList, roles: ['admin', 'super_admin'] },
  { id: 'email', label: 'Email & Templates', icon: Mail, roles: ['admin', 'super_admin'] },
  { id: 'invoice', label: 'Invoice & Billing', icon: DollarSign, roles: ['admin', 'super_admin'] },
  { id: 'security', label: 'Security', icon: Shield, roles: ['super_admin'] },
  { id: 'ai', label: 'AI Platform', icon: Brain, roles: ['admin', 'super_admin'] },
]

const Settings = () => {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('firm')
  const [purging, setPurging] = useState(false)
  const [aiProviders, setAiProviders] = useState([])
  const [aiPrompts, setAiPrompts] = useState([])
  const [aiUsage, setAiUsage] = useState([])
  const [infoModal, setInfoModal] = useState(null)

  const is = (roles) => roles.includes(user?.role)
  const visibleNav = NAV.filter((item) => is(item.roles))

  useEffect(() => {
    // If the current tab isn't visible to this role (e.g. a case_manager
    // somehow lands here), fall back to the first tab they CAN see.
    if (visibleNav.length && !visibleNav.some((n) => n.id === activeTab)) {
      setActiveTab(visibleNav[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.role])

  useEffect(() => {
    if (activeTab !== 'ai' || !is(['admin', 'super_admin'])) return
    Promise.all([api.get('/ai/providers'), api.get('/ai/prompts'), api.get('/ai/usage')])
      .then(([providers, prompts, usage]) => {
        setAiProviders(providers.data.providers || [])
        setAiPrompts(prompts.data.prompts || [])
        setAiUsage(usage.data.usage || [])
      })
      .catch(() => setInfoModal({ message: 'Unable to load AI configuration', variant: 'error' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, user?.role])

  const handlePurgeDemoData = async () => {
    if (!window.confirm('Permanently delete ALL demo/seed users, clients, cases and companies, plus their documents, tasks, messages and analytics rows? This cannot be undone.')) return
    setPurging(true)
    try {
      const response = await api.delete('/admin/demo-data', { data: { confirm: 'DELETE_DEMO_DATA' } })
      const deleted = response.data?.deleted || {}
      setInfoModal({ title: 'Demo data purged', message: Object.entries(deleted).map(([k, v]) => `${k}: ${v}`).join('\n') })
    } catch (error) {
      setInfoModal({ message: error.response?.data?.message || 'Failed to purge demo data', variant: 'error' })
    } finally {
      setPurging(false)
    }
  }

  return (
    <div className="flex gap-8">
      {/* Left rail */}
      <nav className="w-60 shrink-0 space-y-1">
        <div className="mb-4">
          <h1 className="text-xl font-bold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Configure the firm's system</p>
        </div>
        {visibleNav.map((item) => {
          const Icon = item.icon
          const active = activeTab === item.id
          return (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-left transition-colors cursor-pointer ${
                active ? 'bg-blue-50 text-blue-700' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* Content — gated on visibleNav, not just activeTab, so a role that
          can't see a category's nav button also can't render its content
          (activeTab defaults to 'firm' regardless of role; without this
          guard a case_manager landing here would see Firm Profile's
          read-only fields even with an empty nav rail). */}
      <div className="flex-1 min-w-0">
        {!visibleNav.some((n) => n.id === activeTab) ? (
          <p className="text-sm text-muted-foreground">You don't have access to any settings categories.</p>
        ) : (
        <>
        {activeTab === 'firm' && (
          <CategoryPage category="firm" title="Firm Profile" description="Your firm's identity — name, address, brand color, and locale." />
        )}

        {activeTab === 'users' && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">Users & Permissions</h2>
              <p className="text-muted-foreground mt-1 text-sm">Firm members, teams, and branches.</p>
            </div>
            <FirmMembersPanel />
            <TeamsPanel />
            <BranchesPanel />
          </div>
        )}

        {activeTab === 'portal' && (
          <CategoryPage category="portal" title="Client Portal" description="What clients can see and do in the client portal." />
        )}

        {activeTab === 'notifications' && (
          <CategoryPage category="notifications" title="Notifications" description="Firm-wide defaults for who gets notified, on which channel, per event." />
        )}

        {activeTab === 'intake' && (
          <CategoryPage category="intake" title="Questionnaires & Intake" description="Questionnaire access, invitation defaults, and file numbering." />
        )}

        {activeTab === 'email' && (
          <CategoryPage category="email" title="Email & Templates" description="Outbound email defaults and reusable templates.">
            <EmailTemplatesPanel />
          </CategoryPage>
        )}

        {activeTab === 'invoice' && (
          <CategoryPage category="invoice" title="Invoice & Billing" description="Numbering, late fees, reminders, and saved charges.">
            <SavedChargesPanel />
          </CategoryPage>
        )}

        {activeTab === 'security' && (
          <CategoryPage category="security" title="Security" description="Password policy, session/lockout thresholds, and IP allowlisting.">
            <LockedUsersPanel />
            <div className="card border-red-200">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <Trash2 className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h4 className="text-md font-semibold text-foreground">Danger Zone</h4>
                  <p className="text-sm text-muted-foreground">Removes demo/seed data created by the shared backend's seed scripts. Never touches real client, questionnaire, or form template data.</p>
                </div>
              </div>
              <button
                onClick={handlePurgeDemoData}
                disabled={purging}
                className="flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                {purging ? 'Purging...' : 'Purge Demo Data'}
              </button>
            </div>
          </CategoryPage>
        )}

        {activeTab === 'ai' && is(['admin', 'super_admin']) && (
          <div className="space-y-6">
            <div>
              <h2 className="text-xl font-bold text-foreground">AI Platform</h2>
              <p className="text-muted-foreground mt-1 text-sm">Providers, prompt versions, and usage &amp; cost — unchanged, relocated here.</p>
            </div>
            <div className="card">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-violet-100 rounded-lg"><Brain className="w-5 h-5 text-violet-600" /></div>
                <div><h3 className="text-lg font-semibold text-foreground">AI Providers</h3><p className="text-sm text-muted-foreground">Credentials remain in environment variables and are never stored here.</p></div>
              </div>
              <div className="space-y-4">
                {aiProviders.map((provider) => (
                  <div key={provider.key} className="rounded-xl border border-border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div><p className="font-semibold text-foreground">{provider.displayName}</p><p className="text-sm text-muted-foreground">{provider.model} · secret: {provider.apiKeyEnv}</p></div>
                      <div className="flex items-center gap-3">
                        {provider.isDefault && <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">Default</span>}
                        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={provider.enabled} onChange={async (event) => {
                          const response = await api.put(`/ai/providers/${provider.key}`, { enabled: event.target.checked })
                          setAiProviders((current) => current.map((item) => item.key === provider.key ? response.data.provider : item))
                        }} />Enabled</label>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <input value={provider.model || ''} onChange={(event) => setAiProviders((current) => current.map((item) => item.key === provider.key ? { ...item, model: event.target.value } : item))} className="input-field" placeholder="Model" />
                      <input value={provider.endpoint || ''} onChange={(event) => setAiProviders((current) => current.map((item) => item.key === provider.key ? { ...item, endpoint: event.target.value } : item))} className="input-field" placeholder="Provider endpoint" />
                      <input value={provider.limits?.requestsPerMinute || 30} type="number" min="1" onChange={(event) => setAiProviders((current) => current.map((item) => item.key === provider.key ? { ...item, limits: { ...item.limits, requestsPerMinute: Number(event.target.value) } } : item))} className="input-field" placeholder="Requests/minute" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={provider.privacy?.sendSensitiveData !== false} onChange={(event) => setAiProviders((current) => current.map((item) => item.key === provider.key ? { ...item, privacy: { ...item.privacy, sendSensitiveData: event.target.checked } } : item))} />Allow sensitive fields for this provider</label>
                      <button onClick={async () => {
                        const response = await api.put(`/ai/providers/${provider.key}`, {
                          enabled: provider.enabled,
                          isDefault: provider.isDefault,
                          model: provider.model,
                          endpoint: provider.endpoint,
                          limits: provider.limits,
                          privacy: provider.privacy,
                        })
                        setAiProviders((current) => current.map((item) => item.key === provider.key ? response.data.provider : item))
                      }} className="btn-primary">Save Provider</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <div className="card"><h3 className="text-lg font-semibold text-foreground">Prompt Versions</h3><div className="mt-4 space-y-3">{aiPrompts.map((prompt) => <div key={prompt._id} className="rounded-lg border border-border p-3"><div className="flex justify-between gap-3"><div><p className="font-semibold text-foreground">{prompt.name}</p><p className="text-sm text-muted-foreground">{prompt.key} · version {prompt.version}</p></div><span className={`h-fit rounded-full px-2 py-1 text-xs font-semibold ${prompt.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-secondary text-muted-foreground'}`}>{prompt.status}</span></div></div>)}</div></div>
              <div className="card"><h3 className="text-lg font-semibold text-foreground">Usage & Cost</h3><div className="mt-4 space-y-3">{aiUsage.length ? aiUsage.map((row, index) => <div key={index} className="rounded-lg border border-border p-3"><p className="font-semibold text-foreground">{row._id?.provider || 'Unassigned'} · {row._id?.jobType}</p><p className="mt-1 text-sm text-muted-foreground">{row.requests} requests · {row.totalTokens || 0} tokens · ${(row.estimatedCost || 0).toFixed(4)}</p></div>) : <p className="text-sm text-muted-foreground">No AI usage recorded yet.</p>}</div></div>
            </div>
          </div>
        )}
        </>
        )}
      </div>

      {infoModal && <InfoModal {...infoModal} onClose={() => setInfoModal(null)} />}
    </div>
  )
}

export default Settings
