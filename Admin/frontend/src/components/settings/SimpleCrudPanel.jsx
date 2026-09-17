import { useEffect, useState, useCallback } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import api from '../../services/api'

// Shared list+create+delete panel for the three simple CRUD resources this
// pass added (Teams, Branches, Saved Charges) — all three are "a name plus
// a couple of flat fields," so one generic component renders all three
// instead of three near-identical hand-written ones.
export default function SimpleCrudPanel({ title, endpoint, fields, columns, renderRow }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState({})
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get(endpoint)
      setItems(res.data.data || [])
    } finally {
      setLoading(false)
    }
  }, [endpoint])

  useEffect(() => { load() }, [load])

  const handleCreate = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post(endpoint, draft)
      setDraft({})
      setShowForm(false)
      load()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    await api.delete(`${endpoint}/${id}`)
    load()
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-md font-semibold text-foreground">{title}</h3>
        <button onClick={() => setShowForm((v) => !v)} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> New
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-4 rounded-lg border border-border p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {fields.map((f) => (
              <input
                key={f.name}
                required={f.required}
                type={f.type || 'text'}
                placeholder={f.label}
                value={draft[f.name] || ''}
                onChange={(e) => setDraft({ ...draft, [f.name]: f.type === 'number' ? Number(e.target.value) : e.target.value })}
                className="input-field"
              />
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              {columns.map((c) => <th key={c} className="py-2">{c}</th>)}
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item._id} className="border-b border-border/50">
                {renderRow(item)}
                <td className="text-right">
                  <button onClick={() => handleDelete(item._id)} className="text-muted-foreground hover:text-red-600 cursor-pointer">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
