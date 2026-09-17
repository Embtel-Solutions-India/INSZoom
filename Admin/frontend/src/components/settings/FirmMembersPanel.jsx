import { useEffect, useState, useCallback } from 'react'
import { UserPlus } from 'lucide-react'
import api from '../../services/api'

const INVITE_ROLES = ['admin', 'team_lead', 'case_manager']

export default function FirmMembersPanel() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [invite, setInvite] = useState({ name: '', email: '', role: 'case_manager' })
  const [inviting, setInviting] = useState(false)
  const [message, setMessage] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/users')
      setUsers(res.data.users || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleInvite = async (e) => {
    e.preventDefault()
    setInviting(true)
    setMessage(null)
    try {
      await api.post('/users/invite', invite)
      setMessage({ type: 'success', text: `Invitation sent to ${invite.email}.` })
      setInvite({ name: '', email: '', role: 'case_manager' })
      setShowInvite(false)
      load()
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.message || 'Failed to send invitation.' })
    } finally {
      setInviting(false)
    }
  }

  const toggleActive = async (u) => {
    await api.put(`/users/${u._id}/status`, { isActive: !u.isActive })
    load()
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-md font-semibold text-foreground">Firm Members</h3>
        <button onClick={() => setShowInvite((v) => !v)} className="btn-primary flex items-center gap-2 text-sm">
          <UserPlus className="w-4 h-4" /> Invite Firm Member
        </button>
      </div>

      {message && (
        <div className={`mb-4 rounded-lg px-3 py-2 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {showInvite && (
        <form onSubmit={handleInvite} className="mb-4 rounded-lg border border-border p-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input required placeholder="Full name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} className="input-field" />
            <input required type="email" placeholder="Email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} className="input-field" />
            <select value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} className="input-field">
              {INVITE_ROLES.map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setShowInvite(false)} className="rounded-lg border border-border px-4 py-2 text-sm">Cancel</button>
            <button type="submit" disabled={inviting} className="btn-primary text-sm">{inviting ? 'Sending…' : 'Send Invitation'}</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2">Name</th><th>Email</th><th>Role</th><th>Status</th><th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u._id} className="border-b border-border/50">
                <td className="py-2 text-foreground">{u.name || u.displayName || '—'}</td>
                <td className="text-muted-foreground">{u.email}</td>
                <td><span className="rounded-full bg-secondary px-2 py-0.5 text-xs">{u.role}</span></td>
                <td>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {u.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="text-right">
                  <button onClick={() => toggleActive(u)} className="text-xs text-blue-600 hover:underline cursor-pointer">
                    {u.isActive ? 'Deactivate' : 'Reactivate'}
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
