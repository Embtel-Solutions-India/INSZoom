import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import api from '../services/api'
import {
  Settings as SettingsIcon,
  Save,
  Database,
  Bell,
  Shield,
  Key,
  Users,
  Palette,
  CheckCircle,
  XCircle,
  RefreshCw,
  Brain
} from 'lucide-react'

const Settings = () => {
  const { user } = useAuth()
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('general')
  const [testConnectionResult, setTestConnectionResult] = useState(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [aiProviders, setAiProviders] = useState([])
  const [aiPrompts, setAiPrompts] = useState([])
  const [aiUsage, setAiUsage] = useState([])

  // Role helper
  const is = (roles) => roles.includes(user?.role)

  useEffect(() => {
    fetchSettings()
  }, [])

  useEffect(() => {
    if (activeTab !== 'ai' || !is(['admin', 'super_admin'])) return
    Promise.all([api.get('/ai/providers'), api.get('/ai/prompts'), api.get('/ai/usage')])
      .then(([providers, prompts, usage]) => {
        setAiProviders(providers.data.providers || [])
        setAiPrompts(prompts.data.prompts || [])
        setAiUsage(usage.data.usage || [])
      })
      .catch(() => setTestConnectionResult({ success: false, message: 'Unable to load AI configuration' }))
  }, [activeTab, user?.role])

  const fetchSettings = async () => {
    try {
      const response = await api.get('/settings')
      setSettings(response.data.settings)
    } catch (error) {
      console.error('Error fetching settings:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSection = async (section, sectionData) => {
    setSaving(true)
    try {
      await api.put('/settings', { [section]: sectionData })
      alert('Settings saved successfully')
      await fetchSettings()
    } catch (error) {
      console.error('Error saving settings:', error)
      alert('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleTestConnection = async () => {
    setTestingConnection(true)
    setTestConnectionResult(null)
    try {
      await api.get('/health')
      setTestConnectionResult({ success: true, message: 'Shared backend connection successful' })
    } catch (error) {
      setTestConnectionResult({ success: false, message: 'Connection failed' })
    } finally {
      setTestingConnection(false)
    }
  }

  if (loading) {
    return <div className="text-gray-600">Loading settings...</div>
  }

  const tabs = []
  if (is(['admin', 'super_admin'])) {
    tabs.push({ id: 'general', label: 'General', icon: SettingsIcon })
    tabs.push({ id: 'team', label: 'Team', icon: Users })
    tabs.push({ id: 'branding', label: 'Branding', icon: Palette })
    tabs.push({ id: 'ai', label: 'AI Platform', icon: Brain })
  }
  if (is(['super_admin'])) {
    tabs.push({ id: 'integration', label: 'Integration', icon: Database })
    tabs.push({ id: 'security', label: 'Security', icon: Shield })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600 mt-1">Configure system settings and preferences</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {tabs.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-6 py-3 font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-blue-600 border-b-2 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* GENERAL Tab */}
      {activeTab === 'general' && is(['admin', 'super_admin']) && (
        <div className="card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-blue-100 rounded-lg">
              <SettingsIcon className="w-5 h-5 text-blue-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">General Settings</h3>
          </div>

          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Application Name</label>
                <input
                  type="text"
                  value={settings?.companyName || ''}
                  onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
                <select
                  value={settings?.timezone || 'America/New_York'}
                  onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
                  className="input-field"
                >
                  <option value="America/New_York">Eastern Time</option>
                  <option value="America/Chicago">Central Time</option>
                  <option value="America/Denver">Mountain Time</option>
                  <option value="America/Los_Angeles">Pacific Time</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Default Language</label>
                <select
                  value={settings?.defaultLanguage || 'en'}
                  onChange={(e) => setSettings({ ...settings, defaultLanguage: e.target.value })}
                  className="input-field"
                >
                  <option value="en">English</option>
                  <option value="es">Spanish</option>
                  <option value="fr">French</option>
                  <option value="de">German</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Date Format</label>
                <select
                  value={settings?.dateFormat || 'MM/DD/YYYY'}
                  onChange={(e) => setSettings({ ...settings, dateFormat: e.target.value })}
                  className="input-field"
                >
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                </select>
              </div>
            </div>

            <div className="border-t border-gray-200 pt-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Bell className="w-5 h-5 text-amber-600" />
                </div>
                <h4 className="text-md font-semibold text-gray-900">Notification Preferences</h4>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="notifyOnNewCase"
                    checked={settings?.notifyOnNewCase || false}
                    onChange={(e) => setSettings({ ...settings, notifyOnNewCase: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="notifyOnNewCase" className="text-sm text-gray-700">New client submission</label>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="notifyOnPayment"
                    checked={settings?.notifyOnPayment || false}
                    onChange={(e) => setSettings({ ...settings, notifyOnPayment: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="notifyOnPayment" className="text-sm text-gray-700">Payment received</label>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="notifyOnPaymentOverdue"
                    checked={settings?.notifyOnPaymentOverdue || false}
                    onChange={(e) => setSettings({ ...settings, notifyOnPaymentOverdue: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="notifyOnPaymentOverdue" className="text-sm text-gray-700">Payment overdue</label>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="notifyOnRfeReceived"
                    checked={settings?.notifyOnRfeReceived || false}
                    onChange={(e) => setSettings({ ...settings, notifyOnRfeReceived: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="notifyOnRfeReceived" className="text-sm text-gray-700">RFE received</label>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="notifyOnDocumentUpload"
                    checked={settings?.notifyOnDocumentUpload || false}
                    onChange={(e) => setSettings({ ...settings, notifyOnDocumentUpload: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="notifyOnDocumentUpload" className="text-sm text-gray-700">Document upload</label>
                </div>

                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    id="notifyOnEODReport"
                    checked={settings?.notifyOnEODReport || false}
                    onChange={(e) => setSettings({ ...settings, notifyOnEODReport: e.target.checked })}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                  <label htmlFor="notifyOnEODReport" className="text-sm text-gray-700">EOD report</label>
                </div>
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => handleSaveSection('general', {
                  companyName: settings?.companyName,
                  timezone: settings?.timezone,
                  defaultLanguage: settings?.defaultLanguage,
                  dateFormat: settings?.dateFormat,
                  notifyOnNewCase: settings?.notifyOnNewCase,
                  notifyOnPayment: settings?.notifyOnPayment,
                  notifyOnPaymentOverdue: settings?.notifyOnPaymentOverdue,
                  notifyOnRfeReceived: settings?.notifyOnRfeReceived,
                  notifyOnDocumentUpload: settings?.notifyOnDocumentUpload,
                  notifyOnEODReport: settings?.notifyOnEODReport
                })}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save General Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TEAM Tab */}
      {activeTab === 'team' && is(['admin', 'super_admin']) && (
        <div className="card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-purple-100 rounded-lg">
              <Users className="w-5 h-5 text-purple-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Team Settings</h3>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Default Case Assignment Strategy</label>
              <select
                value={settings?.assignmentStrategy || 'manual'}
                onChange={(e) => setSettings({ ...settings, assignmentStrategy: e.target.value })}
                className="input-field"
              >
                <option value="manual">Manual Assignment</option>
                <option value="round_robin">Round Robin</option>
                <option value="least_loaded">Least Loaded</option>
              </select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">SLA: Intake Max Days</label>
                <input
                  type="number"
                  value={settings?.slaIntakeMaxDays || 7}
                  onChange={(e) => setSettings({ ...settings, slaIntakeMaxDays: parseInt(e.target.value) })}
                  className="input-field"
                  min="1"
                />
              </div>

            </div>

            <div className="flex justify-end">
              <button
                onClick={() => handleSaveSection('team', {
                  assignmentStrategy: settings?.assignmentStrategy,
                  slaIntakeMaxDays: settings?.slaIntakeMaxDays
                })}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Team Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ai' && is(['admin', 'super_admin']) && (
        <div className="space-y-6">
          <div className="card">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-violet-100 rounded-lg"><Brain className="w-5 h-5 text-violet-600" /></div>
              <div><h3 className="text-lg font-semibold text-gray-900">AI Providers</h3><p className="text-sm text-gray-500">Credentials remain in environment variables and are never stored here.</p></div>
            </div>
            <div className="space-y-4">
              {aiProviders.map((provider) => (
                <div key={provider.key} className="rounded-xl border border-gray-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div><p className="font-semibold text-gray-900">{provider.displayName}</p><p className="text-sm text-gray-500">{provider.model} · secret: {provider.apiKeyEnv}</p></div>
                    <div className="flex items-center gap-3">
                      {provider.isDefault && <span className="rounded-full bg-blue-100 px-2 py-1 text-xs font-semibold text-blue-700">Default</span>}
                      <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={provider.enabled} onChange={async (event) => {
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
                    <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={provider.privacy?.sendSensitiveData !== false} onChange={(event) => setAiProviders((current) => current.map((item) => item.key === provider.key ? { ...item, privacy: { ...item.privacy, sendSensitiveData: event.target.checked } } : item))} />Allow sensitive fields for this provider</label>
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
            <div className="card"><h3 className="text-lg font-semibold text-gray-900">Prompt Versions</h3><div className="mt-4 space-y-3">{aiPrompts.map((prompt) => <div key={prompt._id} className="rounded-lg border border-gray-200 p-3"><div className="flex justify-between gap-3"><div><p className="font-semibold text-gray-900">{prompt.name}</p><p className="text-sm text-gray-500">{prompt.key} · version {prompt.version}</p></div><span className={`h-fit rounded-full px-2 py-1 text-xs font-semibold ${prompt.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>{prompt.status}</span></div></div>)}</div></div>
            <div className="card"><h3 className="text-lg font-semibold text-gray-900">Usage & Cost</h3><div className="mt-4 space-y-3">{aiUsage.length ? aiUsage.map((row, index) => <div key={index} className="rounded-lg border border-gray-200 p-3"><p className="font-semibold text-gray-900">{row._id?.provider || 'Unassigned'} · {row._id?.jobType}</p><p className="mt-1 text-sm text-gray-500">{row.requests} requests · {row.totalTokens || 0} tokens · ${(row.estimatedCost || 0).toFixed(4)}</p></div>) : <p className="text-sm text-gray-500">No AI usage recorded yet.</p>}</div></div>
          </div>
        </div>
      )}

      {/* INTEGRATION Tab */}
      {activeTab === 'integration' && is(['super_admin']) && (
        <div className="card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-green-100 rounded-lg">
              <Database className="w-5 h-5 text-green-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Integration Settings</h3>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Client Portal URL</label>
              <input
                type="text"
                value={settings?.clientPortalUrl || ''}
                readOnly
                className="input-field bg-gray-100 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">Read-only - configured in environment</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Sync Mode</label>
              <select
                value={settings?.autoSyncEnabled ? 'auto' : 'manual'}
                onChange={(e) => setSettings({ ...settings, autoSyncEnabled: e.target.value === 'auto' })}
                className="input-field"
              >
                <option value="manual">Manual Sync</option>
                <option value="auto">Automatic Sync</option>
              </select>
            </div>

            {settings?.autoSyncEnabled && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Sync Interval (seconds)</label>
                <input
                  type="number"
                  value={settings?.syncInterval || 3600}
                  onChange={(e) => setSettings({ ...settings, syncInterval: parseInt(e.target.value) })}
                  className="input-field"
                  min="60"
                />
              </div>
            )}

            <div className="border-t border-gray-200 pt-6">
              <button
                onClick={handleTestConnection}
                disabled={testingConnection}
                className="btn-secondary flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${testingConnection ? 'animate-spin' : ''}`} />
                {testingConnection ? 'Testing...' : 'Test Connection'}
              </button>

              {testConnectionResult && (
                <div className={`mt-4 p-4 rounded-lg flex items-center gap-3 ${
                  testConnectionResult.success ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
                }`}>
                  {testConnectionResult.success ? (
                    <CheckCircle className="w-5 h-5" />
                  ) : (
                    <XCircle className="w-5 h-5" />
                  )}
                  <span>{testConnectionResult.message}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => handleSaveSection('integration', {
                  autoSyncEnabled: settings?.autoSyncEnabled,
                  syncInterval: settings?.syncInterval
                })}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Integration Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SECURITY Tab */}
      {activeTab === 'security' && is(['super_admin']) && (
        <div className="card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-red-100 rounded-lg">
              <Shield className="w-5 h-5 text-red-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Security Settings</h3>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">JWT Expiry</label>
              <input
                type="text"
                value={settings?.jwtExpiry || '4d'}
                readOnly
                className="input-field bg-gray-100 cursor-not-allowed"
              />
              <p className="text-xs text-gray-500 mt-1">Read-only - configured in environment</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Max Login Attempts</label>
              <input
                type="number"
                value={settings?.maxLoginAttempts || 5}
                onChange={(e) => setSettings({ ...settings, maxLoginAttempts: parseInt(e.target.value) })}
                className="input-field"
                min="1"
                max="10"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Session Timeout (seconds)</label>
              <input
                type="number"
                value={settings?.sessionTimeout || 3600}
                onChange={(e) => setSettings({ ...settings, sessionTimeout: parseInt(e.target.value) })}
                className="input-field"
                min="300"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => handleSaveSection('security', {
                  maxLoginAttempts: settings?.maxLoginAttempts,
                  sessionTimeout: settings?.sessionTimeout
                })}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Security Settings'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BRANDING Tab */}
      {activeTab === 'branding' && is(['admin', 'super_admin']) && (
        <div className="card">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-cyan-100 rounded-lg">
              <Palette className="w-5 h-5 text-cyan-600" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Branding Settings</h3>
          </div>

          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Company Name</label>
              <input
                type="text"
                value={settings?.companyName || ''}
                onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
                className="input-field"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Logo URL</label>
              <input
                type="text"
                value={settings?.companyLogo || ''}
                onChange={(e) => setSettings({ ...settings, companyLogo: e.target.value })}
                className="input-field"
                placeholder="https://example.com/logo.png"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Firm Address</label>
              <input
                type="text"
                value={settings?.firmAddress || ''}
                onChange={(e) => setSettings({ ...settings, firmAddress: e.target.value })}
                className="input-field"
                placeholder="123 Main St, Suite 400, City, ST 00000"
              />
              <p className="mt-1 text-xs text-gray-500">Shown on the letterhead of generated legal documents (e.g. petition cover letters).</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Firm Phone</label>
              <input
                type="text"
                value={settings?.firmPhone || ''}
                onChange={(e) => setSettings({ ...settings, firmPhone: e.target.value })}
                className="input-field"
                placeholder="(555) 123-4567"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Primary Color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={settings?.primaryColor || '#10b981'}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  className="w-16 h-10 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={settings?.primaryColor || '#10b981'}
                  onChange={(e) => setSettings({ ...settings, primaryColor: e.target.value })}
                  className="input-field flex-1"
                  placeholder="#10b981"
                />
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => handleSaveSection('branding', {
                  companyName: settings?.companyName,
                  companyLogo: settings?.companyLogo,
                  firmAddress: settings?.firmAddress,
                  firmPhone: settings?.firmPhone,
                  primaryColor: settings?.primaryColor
                })}
                disabled={saving}
                className="btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving...' : 'Save Branding Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Settings
