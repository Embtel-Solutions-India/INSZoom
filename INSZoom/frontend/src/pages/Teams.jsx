import { useState, useEffect, useCallback } from 'react'
import {
  Users, Plus, Search, Edit2, Trash2, ToggleLeft, ToggleRight,
  Eye, EyeOff, X, AlertCircle, CheckCircle, Loader2,
} from 'lucide-react'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'

// ─── constants ────────────────────────────────────────────────────────────────
const ROLE_ORDER = { super_admin: 0, admin: 1, team_lead: 2, case_manager: 3 }
const ROLE_LABEL = { super_admin: 'Super Admin', admin: 'Admin', team_lead: 'Team Lead', case_manager: 'Case Manager' }
const ROLE_BADGE = {
  super_admin: 'bg-purple-100 text-purple-700',
  admin: 'bg-blue-100 text-blue-700',
  team_lead: 'bg-amber-100 text-amber-700',
  case_manager: 'bg-green-100 text-green-700',
}

// Roles an actor may CREATE (and, on edit, actually reassign someone TO).
// Mirrors Backend/src/modules/team-management/team-management.controller.js's
// ASSIGNABLE_ROLES exactly - team_lead is never allowed to change a role via
// edit, so it's excluded here even though it can create case_managers.
function creatableRoles(actorRole) {
  if (actorRole === 'super_admin') return ['super_admin', 'admin', 'team_lead', 'case_manager']
  if (actorRole === 'admin') return ['admin', 'team_lead', 'case_manager']
  return ['case_manager']
}

// Any staff role (team_lead and above) can edit ANY other staff member's
// credentials here, including super_admin's - per product decision. Mirrors
// the backend's canEditCredentials() exactly. Deliberately broader than
// canRemoveOrDeactivate below.
function canEditCredentials(actor) {
  return ['super_admin', 'admin', 'team_lead'].includes(actor?.role)
}

// Governs BOTH the active-status toggle and delete - mirrors the backend's
// canRemoveOrDeactivate() exactly, including the null-teamId "team_lead
// manages all case_managers" fallback for orgs with no team structure set up.
function canRemoveOrDeactivate(actor, target) {
  if (!actor || !target || actor._id === target._id) return false
  const actorRole = actor.role
  const targetRole = target.role
  if (targetRole === 'super_admin') return false
  if (targetRole === 'admin') return actorRole === 'super_admin'
  if (targetRole === 'team_lead') return ['super_admin', 'admin', 'team_lead'].includes(actorRole)
  if (targetRole === 'case_manager') {
    if (['super_admin', 'admin'].includes(actorRole)) return true
    if (actorRole === 'team_lead') {
      if (!actor.teamId) return true
      return actor.teamId === target.teamId
    }
  }
  return false
}

// Whether the role <select> in the Add/Edit modal should be interactive.
// team_lead never gets an interactive role field (it can't reassign roles at
// all via edit); super_admin/admin get one unless the target's current role
// falls outside what they're allowed to reassign TO (e.g. admin editing a
// super_admin) - shown locked-to-current-value instead of silently omitted,
// so the field never displays a value absent from its own option list.
function roleFieldIsLocked(actorRole, currentTargetRole) {
  if (actorRole === 'team_lead') return true
  if (!currentTargetRole) return false
  return !creatableRoles(actorRole).includes(currentTargetRole)
}

// ─── sub-components ───────────────────────────────────────────────────────────
function RoleBadge({ role }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_BADGE[role] || 'bg-gray-100 text-gray-600'}`}>
      {ROLE_LABEL[role] || role}
    </span>
  )
}

function StatusBadge({ isActive }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
      {isActive ? 'Active' : 'Inactive'}
    </span>
  )
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
      </div>
    </div>
  )
}

function Field({ label, required, hint, children }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {hint && <p className="text-xs text-gray-400 mb-1.5">{hint}</p>}
      {children}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition'
const inputDisabledCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg outline-none bg-gray-50 text-gray-500 cursor-not-allowed'

function PwdInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} value={value} onChange={onChange}
        placeholder={placeholder} className={inputCls + ' pr-9'} />
      <button type="button" onClick={() => setShow((p) => !p)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
        {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

// RoleField: interactive <select> when the actor may reassign this target's
// role, otherwise a disabled <select> containing only the current value -
// "locked", per spec, not hidden - so team_lead / admin-on-super_admin still
// see what the role IS, they just can't change it here.
function RoleField({ actorRole, currentRole, value, onChange }) {
  const locked = roleFieldIsLocked(actorRole, currentRole)
  if (locked) {
    return (
      <select value={currentRole || value} disabled className={inputDisabledCls}>
        <option value={currentRole || value}>{ROLE_LABEL[currentRole || value] || value}</option>
      </select>
    )
  }
  return (
    <select value={value} onChange={onChange} className={inputCls}>
      {creatableRoles(actorRole).map((r) => (
        <option key={r} value={r}>{ROLE_LABEL[r]}</option>
      ))}
    </select>
  )
}

// ─── main ─────────────────────────────────────────────────────────────────────
export default function Teams() {
  const { user: me } = useAuth()

  const [members, setMembers] = useState([])
  const [filtered, setFiltered] = useState([])
  const [loading, setLoading] = useState(true)
  const [pageError, setPageError] = useState(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [toast, setToast] = useState(null)

  const [showAdd, setShowAdd] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'case_manager' })
  const [formError, setFormError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const flash = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3500)
  }

  // ── fetch ─────────────────────────────────────────────────────────────────
  const fetchMembers = useCallback(async () => {
    setLoading(true); setPageError(null)
    try {
      const { data } = await api.get('/team-members')
      const sorted = (data.users || []).sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9))
      setMembers(sorted)
    } catch (e) {
      setPageError(e.response?.data?.message || 'Failed to load team members.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchMembers() }, [fetchMembers])

  // ── client-side filter ─────────────────────────────────────────────────────
  useEffect(() => {
    let list = members
    if (roleFilter) list = list.filter((m) => m.role === roleFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((m) =>
        (m.name || m.displayName || '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
      )
    }
    setFiltered(list)
  }, [members, search, roleFilter])

  // ── validation ────────────────────────────────────────────────────────────
  const validate = (isEdit = false) => {
    if (!form.name.trim()) return 'Full name is required.'
    if (!form.email.trim()) return 'Email is required.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Enter a valid email.'
    if (!isEdit && !form.password) return 'Password is required.'
    if (form.password && form.password.length < 8) return 'Password must be at least 8 characters.'
    return null
  }

  // ── add ───────────────────────────────────────────────────────────────────
  const openAdd = () => {
    const defaultRole = creatableRoles(me.role)[0] || 'case_manager'
    setForm({ name: '', email: '', password: '', role: defaultRole })
    setFormError(null)
    setShowAdd(true)
  }
  const handleAdd = async () => {
    const err = validate(false); if (err) return setFormError(err)
    setSubmitting(true); setFormError(null)
    try {
      await api.post('/team-members', { name: form.name, email: form.email, password: form.password, role: form.role })
      setShowAdd(false); fetchMembers(); flash('Member created successfully.')
    } catch (e) { setFormError(e.response?.data?.message || 'Failed to create member.') }
    finally { setSubmitting(false) }
  }

  // ── edit ──────────────────────────────────────────────────────────────────
  const openEdit = (m) => {
    setEditTarget(m)
    setForm({ name: m.name || m.displayName || '', email: m.email, password: '', role: m.role })
    setFormError(null)
  }
  const handleEdit = async () => {
    const err = validate(true); if (err) return setFormError(err)
    setSubmitting(true); setFormError(null)
    try {
      const payload = { name: form.name, email: form.email }
      if (!roleFieldIsLocked(me.role, editTarget.role)) payload.role = form.role
      if (form.password.trim()) payload.password = form.password
      await api.patch(`/team-members/${editTarget._id}`, payload)
      setEditTarget(null); fetchMembers(); flash('Member updated.')
    } catch (e) { setFormError(e.response?.data?.message || 'Failed to update.') }
    finally { setSubmitting(false) }
  }

  // ── toggle active ─────────────────────────────────────────────────────────
  const toggleActive = async (m) => {
    try {
      await api.patch(`/team-members/${m._id}`, { isActive: !m.isActive })
      fetchMembers()
      flash(`${m.name || m.displayName} ${!m.isActive ? 'activated' : 'deactivated'}.`)
    } catch (e) { flash(e.response?.data?.message || 'Failed.', 'error') }
  }

  // ── delete ────────────────────────────────────────────────────────────────
  const handleDelete = async () => {
    setSubmitting(true)
    try {
      await api.delete(`/team-members/${deleteTarget._id}`)
      setDeleteTarget(null); fetchMembers(); flash('Member deactivated.')
    } catch (e) { flash(e.response?.data?.message || 'Failed.', 'error') }
    finally { setSubmitting(false) }
  }

  const sf = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }))

  // Session can expire while this page is still mounted (e.g. a 401 fires a
  // global logout elsewhere) - `me` goes null a render before Layout/
  // ProtectedRoute actually redirects away, and everything below reads
  // me.role/me._id, so bail out cleanly instead of throwing.
  if (!me) return null

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-xs font-semibold
          ${toast.type === 'error' ? 'bg-red-50 border border-red-200 text-red-700' : 'bg-green-50 border border-green-200 text-green-700'}`}>
          {toast.type === 'error' ? <AlertCircle className="w-3.5 h-3.5" /> : <CheckCircle className="w-3.5 h-3.5" />}
          {toast.msg}
        </div>
      )}

      {/* header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary-600" />
          <div>
            <h1 className="text-lg font-bold text-gray-900">Teams</h1>
            <p className="text-xs text-gray-500">Manage staff accounts and credentials</p>
          </div>
        </div>
        <button onClick={openAdd} className="btn-primary flex items-center gap-2 text-sm whitespace-nowrap">
          <Plus className="w-4 h-4" /> Add Member
        </button>
      </div>

      {/* filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email…"
            className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="w-full sm:w-auto px-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">All Roles</option>
          <option value="super_admin">Super Admin</option>
          <option value="admin">Admin</option>
          <option value="team_lead">Team Lead</option>
          <option value="case_manager">Case Manager</option>
        </select>
      </div>

      {/* page error */}
      {pageError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          <AlertCircle className="w-4 h-4 shrink-0" /> {pageError}
        </div>
      )}

      {/* table */}
      <div className="card !p-0 md:!p-5">
        {loading ? (
          <div className="flex items-center justify-center h-48 gap-2 text-gray-500 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading team members…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 text-sm gap-2">
            <Users className="w-8 h-8 opacity-30" />
            <p>{search || roleFilter ? 'No members match your filters.' : 'No team members yet.'}</p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-100">
              {filtered.map((m) => {
                const isSelf = m._id === me._id
                const showEdit = canEditCredentials(me)
                const showToggle = canRemoveOrDeactivate(me, m)
                const showDelete = canRemoveOrDeactivate(me, m)
                return (
                  <div key={m._id} className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">
                          {m.name || m.displayName}
                          {isSelf && <span className="ml-1.5 text-[10px] font-semibold text-blue-500 uppercase tracking-wide">(you)</span>}
                        </p>
                        <p className="text-xs text-gray-500">{m.email}</p>
                      </div>
                      <RoleBadge role={m.role} />
                    </div>
                    <div className="flex items-center justify-between">
                      <StatusBadge isActive={m.isActive} />
                      <div className="flex items-center gap-1.5">
                        {showEdit && (
                          <button onClick={() => openEdit(m)} title="Edit"
                            className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition">
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {showToggle && (
                          <button onClick={() => toggleActive(m)} title={m.isActive ? 'Deactivate' : 'Activate'}
                            className="p-1.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition">
                            {m.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                          </button>
                        )}
                        {showDelete && (
                          <button onClick={() => setDeleteTarget(m)} title="Remove"
                            className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                    <th className="px-3 py-2.5 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-3 py-2.5 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m) => {
                    const isSelf = m._id === me._id
                    const showEdit = canEditCredentials(me)
                    const showToggle = canRemoveOrDeactivate(me, m)
                    const showDelete = canRemoveOrDeactivate(me, m)
                    return (
                      <tr key={m._id} className="border-b hover:bg-gray-50 transition">
                        <td className="px-3 py-3">
                          <p className="font-medium text-gray-900 text-sm truncate max-w-[180px]" title={m.name || m.displayName}>
                            {m.name || m.displayName || '—'}
                            {isSelf && <span className="ml-1.5 text-[10px] font-semibold text-blue-500 uppercase tracking-wide">(you)</span>}
                          </p>
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-600 truncate max-w-[220px]" title={m.email}>{m.email}</td>
                        <td className="px-3 py-3"><RoleBadge role={m.role} /></td>
                        <td className="px-3 py-3"><StatusBadge isActive={m.isActive} /></td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            {showEdit && (
                              <button onClick={() => openEdit(m)} title="Edit"
                                className="p-1.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition">
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {showToggle && (
                              <button onClick={() => toggleActive(m)} title={m.isActive ? 'Deactivate' : 'Activate'}
                                className="p-1.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 transition">
                                {m.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            {showDelete && (
                              <button onClick={() => setDeleteTarget(m)} title="Deactivate"
                                className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 transition">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!showEdit && !showToggle && !showDelete && (
                              <span className="text-xs text-gray-300 px-2">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* ── Add Modal ── */}
      {showAdd && (
        <Modal title="Add Team Member" onClose={() => setShowAdd(false)}>
          {formError && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-medium rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {formError}
            </div>
          )}
          <Field label="Full Name" required>
            <input value={form.name} onChange={sf('name')} placeholder="e.g. Jane Smith" className={inputCls} />
          </Field>
          <Field label="Email" required>
            <input type="email" value={form.email} onChange={sf('email')} placeholder="jane@domain.com" className={inputCls} />
          </Field>
          <Field label="Role" required>
            <select value={form.role} onChange={sf('role')} className={inputCls}>
              {creatableRoles(me.role).map((r) => (
                <option key={r} value={r}>{ROLE_LABEL[r]}</option>
              ))}
            </select>
          </Field>
          <Field label="Password" required>
            <PwdInput value={form.password} onChange={sf('password')} placeholder="Min. 8 characters" />
          </Field>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setShowAdd(false)} disabled={submitting}
              className="flex-1 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Cancel</button>
            <button onClick={handleAdd} disabled={submitting}
              className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {submitting ? 'Creating…' : 'Create Member'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Edit Modal ── */}
      {editTarget && (
        <Modal title={`Edit — ${editTarget.name || editTarget.displayName}`} onClose={() => setEditTarget(null)}>
          {formError && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2.5 bg-red-50 border border-red-200 text-red-700 text-xs font-medium rounded-lg">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" /> {formError}
            </div>
          )}
          <Field label="Full Name" required>
            <input value={form.name} onChange={sf('name')} className={inputCls} />
          </Field>
          <Field label="Email" required>
            <input type="email" value={form.email} onChange={sf('email')} className={inputCls} />
          </Field>
          <Field
            label="Role"
            required
            hint={roleFieldIsLocked(me.role, editTarget.role) ? 'Your role cannot reassign this account’s role here.' : null}
          >
            <RoleField actorRole={me.role} currentRole={editTarget.role} value={form.role} onChange={sf('role')} />
          </Field>
          <Field label="New Password" hint="Leave blank to keep the current password.">
            <PwdInput value={form.password} onChange={sf('password')} placeholder="••••••••" />
          </Field>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setEditTarget(null)} disabled={submitting}
              className="flex-1 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Cancel</button>
            <button onClick={handleEdit} disabled={submitting}
              className="flex-1 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {submitting ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Delete Confirm ── */}
      {deleteTarget && (
        <Modal title="Deactivate Member" onClose={() => setDeleteTarget(null)}>
          <p className="text-sm text-gray-600 mb-6">
            Deactivate <strong className="text-gray-900">{deleteTarget.name || deleteTarget.displayName}</strong>?
            They will lose access immediately. You can reactivate them later.
          </p>
          <div className="flex gap-3">
            <button onClick={() => setDeleteTarget(null)} disabled={submitting}
              className="flex-1 py-2 text-sm font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition">Cancel</button>
            <button onClick={handleDelete} disabled={submitting}
              className="flex-1 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {submitting ? 'Deactivating…' : 'Deactivate'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
