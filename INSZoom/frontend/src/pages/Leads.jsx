import { useState, useEffect, useRef, useMemo } from 'react'
import { leadsApi } from '../services/api'
import {
  Inbox,
  Search,
  Mail,
  Phone,
  X,
  Calendar,
  Video,
  PhoneCall,
} from 'lucide-react'

const TIER_COLORS = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-amber-100 text-amber-800',
  D: 'bg-gray-100 text-gray-600',
}

const STATUS_OPTIONS = ['new', 'contacted', 'booked', 'converted', 'closed']

const STATUS_COLORS = {
  new: 'bg-amber-100 text-amber-800',
  contacted: 'bg-blue-100 text-blue-800',
  booked: 'bg-green-100 text-green-800',
  converted: 'bg-purple-100 text-purple-800',
  closed: 'bg-gray-100 text-gray-600',
}

function initials(name) {
  if (!name) return '?'
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

function timeAgo(dateStr) {
  if (!dateStr) return '—'
  const diffMs = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const Leads = () => {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tierFilter, setTierFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [noteDraft, setNoteDraft] = useState('')

  const hasLoadedOnce = useRef(false)

  const fetchLeads = async () => {
    try {
      if (!hasLoadedOnce.current) setLoading(true)
      const response = await leadsApi.list({ limit: 200 })
      setLeads(response.data.items || [])
    } catch (error) {
      console.error('Error fetching leads:', error)
    } finally {
      hasLoadedOnce.current = true
      setLoading(false)
    }
  }

  useEffect(() => { fetchLeads() }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return leads.filter((lead) => {
      const matchSearch = !q
        || (lead.fullName || '').toLowerCase().includes(q)
        || (lead.email || '').toLowerCase().includes(q)
        || (lead.phone || '').toLowerCase().includes(q)
      const matchTier = !tierFilter || lead.scoreResult?.tier === tierFilter
      const matchStatus = !statusFilter || lead.status === statusFilter
      return matchSearch && matchTier && matchStatus
    })
  }, [leads, search, tierFilter, statusFilter])

  const newCount = leads.filter((l) => !l.seenAt).length
  const selectedLead = leads.find((l) => l._id === selectedId) || null

  const openLead = async (lead) => {
    setSelectedId(lead._id)
    setNoteDraft('')
    if (!lead.seenAt) {
      try {
        const response = await leadsApi.markSeen(lead._id)
        setLeads((prev) => prev.map((l) => (l._id === lead._id ? response.data.data : l)))
      } catch (error) {
        console.error('Error marking lead seen:', error)
      }
    }
  }

  const updateStatus = async (id, status) => {
    try {
      const response = await leadsApi.updateStatus(id, status)
      setLeads((prev) => prev.map((l) => (l._id === id ? response.data.data : l)))
    } catch (error) {
      console.error('Error updating lead status:', error)
    }
  }

  const submitNote = async () => {
    const text = noteDraft.trim()
    if (!text || !selectedLead) return
    try {
      const response = await leadsApi.addNote(selectedLead._id, text)
      setLeads((prev) => prev.map((l) => (l._id === selectedLead._id ? response.data.data : l)))
      setNoteDraft('')
    } catch (error) {
      console.error('Error adding note:', error)
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/4" />
          <div className="h-64 bg-gray-200 rounded" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leads</h1>
          <p className="text-gray-600 mt-1">{leads.length} total from the public eligibility quiz &middot; {newCount} new</p>
        </div>
      </div>

      {/* Search and filters */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <select
            value={tierFilter}
            onChange={(e) => setTierFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="">All Tiers</option>
            {['A', 'B', 'C', 'D'].map((t) => <option key={t} value={t}>Tier {t}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          >
            <option value="">All Status</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Inbox className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No leads found</h3>
            <p className="text-gray-500">Try adjusting your search or filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Lead</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tier</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Pathway</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Consultation</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((lead) => {
                  const unseen = !lead.seenAt
                  const consultation = lead.consultationId && typeof lead.consultationId === 'object' ? lead.consultationId : null
                  return (
                    <tr
                      key={lead._id}
                      onClick={() => openLead(lead)}
                      className={`cursor-pointer transition-colors ${unseen ? 'bg-amber-50 hover:bg-amber-100' : 'hover:bg-gray-50'}`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="flex-shrink-0 h-9 w-9 bg-gradient-to-br from-primary-500 to-secondary-600 rounded-full flex items-center justify-center text-white text-xs font-semibold">
                            {initials(lead.fullName)}
                          </div>
                          <div className="ml-3 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-900 truncate">{lead.fullName || 'Unknown'}</span>
                              {unseen && (
                                <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide bg-amber-500 text-white rounded-full">
                                  New
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-500 truncate">{lead.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${TIER_COLORS[lead.scoreResult?.tier] || 'bg-gray-100 text-gray-500'}`}>
                          Tier {lead.scoreResult?.tier || '—'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">{lead.visaPathway || '—'}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                        {consultation?.startAt ? (
                          <div className="flex items-center gap-1.5 text-green-700">
                            <Calendar className="w-3.5 h-3.5" />
                            {new Date(consultation.startAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                          </div>
                        ) : (
                          <span className="text-gray-400">Not booked</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full capitalize ${STATUS_COLORS[lead.status] || 'bg-gray-100 text-gray-500'}`}>
                          {lead.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-xs text-gray-400">{timeAgo(lead.createdAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail drawer */}
      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          noteDraft={noteDraft}
          setNoteDraft={setNoteDraft}
          onClose={() => setSelectedId(null)}
          onUpdateStatus={updateStatus}
          onSubmitNote={submitNote}
        />
      )}
    </div>
  )
}

function LeadDrawer({ lead, noteDraft, setNoteDraft, onClose, onUpdateStatus, onSubmitNote }) {
  const consultation = lead.consultationId && typeof lead.consultationId === 'object' ? lead.consultationId : null
  const evidence = lead.scoreResult?.evidenceStrength?.length
    ? lead.scoreResult.evidenceStrength
    : (lead.criteriaAnswers || []).map((c) => ({ key: c.key, value: c.value, label: c.met ? 'Strong' : c.developable ? 'Developing' : 'None' }))

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-5 flex items-start justify-between z-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-1">
              Tier {lead.scoreResult?.tier || '—'} &middot; {lead.scoreResult?.pathwayString || lead.visaPathway}
            </p>
            <h3 className="text-lg font-bold text-gray-900">{lead.fullName || 'Unknown'}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Contact */}
          <div className="flex flex-wrap gap-3">
            <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100">
              <Mail className="w-3.5 h-3.5" /> {lead.email}
            </a>
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-100">
                <Phone className="w-3.5 h-3.5" /> {lead.phone}
              </a>
            )}
          </div>

          {/* Consultation booking */}
          {consultation && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3.5">
              <p className="text-xs font-bold uppercase tracking-wider text-green-700 mb-1.5">Consultation booked</p>
              <p className="text-sm font-semibold text-gray-800">
                {consultation.startAt
                  ? new Date(consultation.startAt).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                  : '—'}
              </p>
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
                {consultation.locationType === 'phone' ? <PhoneCall className="w-3.5 h-3.5" /> : <Video className="w-3.5 h-3.5" />}
                {consultation.locationType === 'phone' ? 'Phone call' : 'Video call'}
                {consultation.status ? ` · ${consultation.status}` : ''}
              </p>
            </div>
          )}

          {/* Status */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-1.5">Status</label>
            <select
              value={lead.status}
              onChange={(e) => onUpdateStatus(lead._id, e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-lg bg-white px-3 py-2.5 text-gray-700 focus:ring-2 focus:ring-primary-500"
            >
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>

          {/* Profile answers (from the quiz) */}
          {lead.profileAnswers && Object.keys(lead.profileAnswers).length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Profile</p>
              <div className="rounded-lg border border-gray-100 divide-y divide-gray-100">
                {Object.entries(lead.profileAnswers).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-gray-500 capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>
                    <span className="font-semibold text-gray-800">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Evidence strength */}
          {evidence.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-3">Evidence strength</p>
              <div className="space-y-2.5">
                {evidence.map((e) => (
                  <div key={e.key} className="flex items-center gap-3">
                    <span className="text-xs text-gray-500 w-36 shrink-0 truncate">{e.key.replace(/_/g, ' ')}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${e.value >= 2 ? 'bg-green-500' : e.value === 1 ? 'bg-amber-400' : 'bg-gray-300'}`}
                        style={{ width: `${((e.value ?? 0) / 3) * 100}%` }}
                      />
                    </div>
                    <span className="text-[0.68rem] text-gray-400 w-16 shrink-0">{e.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 mb-2">Notes</p>
            <div className="space-y-2 mb-3">
              {(lead.notes || []).length === 0 && <p className="text-xs text-gray-400">No notes yet.</p>}
              {(lead.notes || []).map((n, i) => (
                <div key={i} className="rounded-lg bg-gray-50 border border-gray-100 px-3.5 py-2.5">
                  <p className="text-sm text-gray-700">{n.text}</p>
                  <p className="text-[0.68rem] text-gray-400 mt-1">{timeAgo(n.createdAt)}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') onSubmitNote() }}
                placeholder="Add a note..."
                className="flex-1 text-sm border border-gray-300 rounded-lg px-3.5 py-2.5 focus:ring-2 focus:ring-primary-500"
              />
              <button
                onClick={onSubmitNote}
                className="px-4 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-xs font-bold"
              >
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Leads
