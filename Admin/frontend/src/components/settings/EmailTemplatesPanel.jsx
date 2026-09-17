import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2, Lock } from 'lucide-react'
import api from '../../services/api'

const MERGE_TAGS = ['{{client.name}}', '{{case.id}}', '{{visa.type}}', '{{firm.name}}', '{{portal.link}}']

export default function EmailTemplatesPanel() {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null) // template being edited, or {} for new
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/email-templates')
      setTemplates(res.data.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing._id) {
        await api.patch(`/email-templates/${editing._id}`, editing.isSystem ? { subject: editing.subject } : editing)
      } else {
        await api.post('/email-templates', editing)
      }
      setEditing(null)
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    await api.delete(`/email-templates/${id}`)
    load()
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-md font-semibold text-foreground">Email Templates</h3>
        <button onClick={() => setEditing({ name: '', subject: '', body: '', category: 'general' })} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> New Template
        </button>
      </div>

      {editing && (
        <form onSubmit={handleSave} className="mb-4 rounded-lg border border-border p-4 space-y-3">
          {!editing.isSystem && (
            <input required placeholder="Template name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="input-field" />
          )}
          <input required placeholder="Subject" value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} className="input-field" />
          {!editing.isSystem && (
            <>
              <p className="text-xs text-muted-foreground">Merge tags: {MERGE_TAGS.join('  ')}</p>
              <textarea required rows={5} placeholder="Body" value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} className="input-field" />
            </>
          )}
          {editing.isSystem && <p className="text-xs text-muted-foreground italic">System template — only the subject can be edited.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save Template'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2">Name</th><th>Category</th><th>Subject</th><th></th>
            </tr>
          </thead>
          <tbody>
            {templates.map((t) => (
              <tr key={t._id} className="border-b border-border/50">
                <td className="py-2 text-foreground flex items-center gap-1.5">{t.isSystem && <Lock className="w-3 h-3 text-muted-foreground" />} {t.name}</td>
                <td className="text-muted-foreground">{t.category}</td>
                <td className="text-muted-foreground truncate max-w-xs">{t.subject}</td>
                <td className="text-right whitespace-nowrap">
                  <button onClick={() => setEditing(t)} className="text-xs text-blue-600 hover:underline mr-3 cursor-pointer">Edit</button>
                  {!t.isSystem && (
                    <button onClick={() => handleDelete(t._id)} className="text-muted-foreground hover:text-red-600 cursor-pointer">
                      <Trash2 className="w-4 h-4 inline" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
