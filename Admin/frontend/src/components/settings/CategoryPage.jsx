import { useEffect, useState, useCallback } from 'react'
import { Save, RotateCcw } from 'lucide-react'
import api from '../../services/api'
import SettingField from './SettingField'

// Generic, schema-driven settings page — renders WHATEVER the
// /api/settings-v2/catalog response contains for `category`, grouped by
// `group`, via SettingField. Used as the entire content for Firm Profile,
// Client Portal, Notifications, Questionnaires & Intake, Email & Templates
// (defaults section), Invoice & Billing (defaults section), and Security —
// 7 of 9 categories reuse this ONE component instead of 7 hand-built forms.
// Extra, non-registry content (Firm Members table, Email Template CRUD,
// Saved Charges CRUD, Locked Users panel) is passed in as `children` and
// rendered below the generic fields.
export default function CategoryPage({ category, title, description, children }) {
  const [grouped, setGrouped] = useState(null)
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState({})
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/settings-v2/catalog')
      setGrouped(res.data.data.grouped[category] || {})
    } catch {
      setGrouped({})
    } finally {
      setLoading(false)
    }
  }, [category])

  useEffect(() => { load() }, [load])

  const isDirty = Object.keys(dirty).length > 0

  const handleChange = (key, value) => {
    setDirty((d) => ({ ...d, [key]: value }))
    setFieldErrors((e) => ({ ...e, [key]: undefined }))
  }

  const handleDiscard = () => { setDirty({}); setFieldErrors({}) }

  const handleSave = async () => {
    setSaving(true)
    setToast(null)
    try {
      const changes = Object.entries(dirty).map(([key, value]) => ({ key, scope: 'system', value }))
      await api.patch('/settings-v2', { changes })
      setToast({ type: 'success', message: 'Settings saved.' })
      setDirty({})
      setFieldErrors({})
      await load()
    } catch (err) {
      const message = err.response?.data?.message || 'Failed to save settings.'
      if (err.response?.status === 422) {
        // Best-effort: surface the server's message under every dirty field
        // touched by this save — the API returns one message per failed
        // key in sequence (bulkSet fails the whole batch atomically), not a
        // per-field map, so this is the closest honest mapping available.
        setFieldErrors(Object.fromEntries(Object.keys(dirty).map((k) => [k, message])))
      }
      setToast({ type: 'error', message })
      // Dirty state deliberately preserved on error — user's edits aren't lost.
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-muted-foreground">Loading…</div>

  const groupNames = Object.keys(grouped || {})

  return (
    <div className="space-y-6 pb-20">
      <div>
        <h2 className="text-xl font-bold text-foreground">{title}</h2>
        {description && <p className="text-muted-foreground mt-1 text-sm">{description}</p>}
      </div>

      {toast && (
        <div className={`rounded-lg px-4 py-2.5 text-sm ${toast.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {toast.message}
        </div>
      )}

      {groupNames.length === 0 && !children && (
        <p className="text-sm text-muted-foreground">No settings in this category yet.</p>
      )}

      {groupNames.map((groupName) => (
        <div key={groupName} className="card">
          <h3 className="text-md font-semibold text-foreground mb-4">{groupName}</h3>
          <div className="space-y-5">
            {grouped[groupName].map((entry) => (
              <SettingField
                key={entry.key}
                entry={entry}
                value={entry.key in dirty ? dirty[entry.key] : entry.value}
                onChange={(v) => handleChange(entry.key, v)}
                error={fieldErrors[entry.key]}
                disabled={!entry.canManage}
              />
            ))}
          </div>
        </div>
      ))}

      {children}

      {isDirty && (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-card px-6 py-3 shadow-lg flex items-center justify-between">
          <span className="text-sm text-muted-foreground">You have unsaved changes.</span>
          <div className="flex items-center gap-3">
            <button onClick={handleDiscard} disabled={saving} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary cursor-pointer">
              <RotateCcw className="w-4 h-4" /> Discard
            </button>
            <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
