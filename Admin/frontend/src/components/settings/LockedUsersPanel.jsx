import { useEffect, useState, useCallback } from 'react'
import api from '../../services/api'

// Polls every 30s while mounted, per the spec — a locked user should show
// up here without the admin needing to refresh the page.
export default function LockedUsersPanel() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await api.get('/users/locked')
      setUsers(res.data.users || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [load])

  const unlock = async (id) => {
    await api.patch(`/users/${id}/unlock`)
    load()
  }

  return (
    <div className="card">
      <h3 className="text-md font-semibold text-foreground mb-4">Locked Users</h3>
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No locked users.</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u._id} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <div>
                <p className="text-sm font-medium text-foreground">{u.name || u.displayName}</p>
                <p className="text-xs text-muted-foreground">{u.email} — locked until {new Date(u.lockedUntil).toLocaleTimeString()}</p>
              </div>
              <button onClick={() => unlock(u._id)} className="text-xs text-blue-600 hover:underline cursor-pointer">Unlock</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
