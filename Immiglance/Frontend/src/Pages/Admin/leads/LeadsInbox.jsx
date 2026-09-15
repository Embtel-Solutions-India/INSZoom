import { useMemo, useState } from "react";

const STAFF_ROLES = ["super_admin", "admin", "case_manager", "team_lead"];
const PAGE_SIZE = 20;

const TIER_COLORS = {
  A: "bg-emerald-100 text-emerald-700 border-emerald-200",
  B: "bg-blue-100 text-blue-700 border-blue-200",
  C: "bg-amber-100 text-amber-700 border-amber-200",
  D: "bg-slate-100 text-slate-600 border-slate-200",
};

const LEAD_STATUS_COLORS = {
  new: "bg-amber-100 text-amber-700 border-amber-200",
  contacted: "bg-blue-100 text-blue-700 border-blue-200",
  booked: "bg-emerald-100 text-emerald-700 border-emerald-200",
  converted: "bg-violet-100 text-violet-700 border-violet-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_OPTIONS = ["new", "contacted", "booked", "converted", "closed"];

function Badge({ text, className = "" }) {
  return (
    <span className={`inline-block text-[0.7rem] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${className}`}>
      {text}
    </span>
  );
}

function initials(name) {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function IconSearch() {
  return <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>;
}
function IconInbox({ className = "" }) {
  return <svg width="40" height="40" fill="none" stroke="currentColor" viewBox="0 0 24 24" className={className}><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M3 12h4l2 3h6l2-3h4M5 5h14l1.5 7v8a1 1 0 01-1 1H4.5a1 1 0 01-1-1v-8L5 5z"/></svg>;
}
function IconX() {
  return <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>;
}
function IconMail() {
  return <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>;
}
function IconPhone() {
  return <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 17.72V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/></svg>;
}

export default function LeadsInbox({ leads, users, onMarkSeen, onUpdateStatus, onAssign, onAddNote }) {
  const [search, setSearch] = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterVisa, setFilterVisa] = useState("all");
  const [sortBy, setSortBy] = useState("newest");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const [noteDraft, setNoteDraft] = useState("");

  const visaOptions = useMemo(() => [...new Set(leads.map((l) => l.visaPathway).filter(Boolean))], [leads]);
  const staffUsers = useMemo(() => (users || []).filter((u) => STAFF_ROLES.includes(u.role)), [users]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let result = leads.filter((l) => {
      const matchSearch = !q
        || (l.fullName || "").toLowerCase().includes(q)
        || (l.email || "").toLowerCase().includes(q)
        || (l.phone || "").toLowerCase().includes(q);
      const matchTier = filterTier === "all" || l.scoreResult?.tier === filterTier;
      const matchStatus = filterStatus === "all" || l.status === filterStatus;
      const matchVisa = filterVisa === "all" || l.visaPathway === filterVisa;
      return matchSearch && matchTier && matchStatus && matchVisa;
    });
    result = [...result].sort((a, b) => {
      if (sortBy === "oldest") return new Date(a.createdAt) - new Date(b.createdAt);
      if (sortBy === "tier") return (a.scoreResult?.tier || "Z").localeCompare(b.scoreResult?.tier || "Z");
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return result;
  }, [leads, search, filterTier, filterStatus, filterVisa, sortBy]);

  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const unseenCount = leads.filter((l) => !l.seenAt).length;

  const selectedLead = leads.find((l) => l._id === selectedId) || null;

  const openLead = (lead) => {
    setSelectedId(lead._id);
    setNoteDraft("");
    if (!lead.seenAt) onMarkSeen(lead._id);
  };

  const resetPage = (fn) => (val) => { fn(val); setPage(1); };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 mb-1">Leads Inbox</h2>
          <p className="text-sm text-slate-500">{leads.length} total &middot; {unseenCount} new</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><IconSearch /></span>
            <input value={search} onChange={(e) => resetPage(setSearch)(e.target.value)}
              placeholder="Search name, email, phone…"
              className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white
                text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all w-48 sm:w-56"/>
          </div>
          <select value={filterTier} onChange={(e) => resetPage(setFilterTier)(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5 text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
            <option value="all">All Tiers</option>
            {["A", "B", "C", "D"].map((t) => <option key={t} value={t}>Tier {t}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => resetPage(setFilterStatus)(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5 text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
            <option value="all">All Status</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
          </select>
          <select value={filterVisa} onChange={(e) => resetPage(setFilterVisa)(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5 text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
            <option value="all">All Pathways</option>
            {visaOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5 text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="tier">By tier</option>
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <IconInbox className="text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500 text-sm">No leads found{search ? ` for "${search}"` : ""}.</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Lead</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Tier</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Pathway</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden md:table-cell">Source</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((lead) => {
                    const unseen = !lead.seenAt;
                    return (
                      <tr key={lead._id} onClick={() => openLead(lead)}
                        className={`border-b border-slate-50 last:border-0 cursor-pointer transition-colors
                          ${unseen ? "bg-amber-50/60 hover:bg-amber-50" : "hover:bg-slate-50"}`}>
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
                              flex items-center justify-center text-white text-[0.65rem] font-extrabold shrink-0">
                              {initials(lead.fullName)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-slate-800 truncate">{lead.fullName || "Unknown"}</p>
                                {unseen && <Badge text="NEW" className="bg-amber-500 text-white border-amber-500" />}
                              </div>
                              <p className="text-xs text-slate-500 truncate">{lead.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <Badge text={`Tier ${lead.scoreResult?.tier || "—"}`} className={TIER_COLORS[lead.scoreResult?.tier] || "bg-slate-100 text-slate-500 border-slate-200"} />
                        </td>
                        <td className="px-5 py-4 hidden sm:table-cell text-sm text-slate-600">{lead.visaPathway || "—"}</td>
                        <td className="px-5 py-4 hidden md:table-cell text-sm text-slate-500">{lead.utm?.source || lead.source || "direct"}</td>
                        <td className="px-5 py-4">
                          <Badge text={lead.status} className={LEAD_STATUS_COLORS[lead.status] || "bg-slate-100 text-slate-500 border-slate-200"} />
                        </td>
                        <td className="px-5 py-4 hidden lg:table-cell text-xs text-slate-400">{timeAgo(lead.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between px-5 py-3.5 border-t border-slate-100">
                <p className="text-xs text-slate-400">Page {page} of {totalPages}</p>
                <div className="flex gap-2">
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed">
                    Previous
                  </button>
                  <button disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}
                    className="px-3 py-1.5 text-xs font-bold rounded-lg border border-slate-200 text-slate-600 disabled:opacity-40 hover:bg-slate-50 cursor-pointer disabled:cursor-not-allowed">
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selectedLead && (
        <LeadDetailDrawer
          lead={selectedLead}
          staffUsers={staffUsers}
          noteDraft={noteDraft}
          setNoteDraft={setNoteDraft}
          onClose={() => setSelectedId(null)}
          onUpdateStatus={onUpdateStatus}
          onAssign={onAssign}
          onAddNote={onAddNote}
        />
      )}
    </div>
  );
}

function LeadDetailDrawer({ lead, staffUsers, noteDraft, setNoteDraft, onClose, onUpdateStatus, onAssign, onAddNote }) {
  const evidence = lead.scoreResult?.evidenceStrength?.length ? lead.scoreResult.evidenceStrength : (lead.criteriaAnswers || []).map((c) => ({ key: c.key, value: c.value, label: c.met ? "Strong" : c.developable ? "Developing" : "None" }));
  const criteriaByKey = Object.fromEntries((lead.criteriaAnswers || []).map((c) => [c.key, c]));

  const submitNote = () => {
    const text = noteDraft.trim();
    if (!text) return;
    onAddNote(lead._id, text);
    setNoteDraft("");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl">
        <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-5 flex items-start justify-between z-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Tier {lead.scoreResult?.tier || "—"} &middot; {lead.scoreResult?.pathwayString || lead.visaPathway}
            </p>
            <h3 className="text-lg font-extrabold text-slate-900">{lead.fullName || "Unknown"}</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer">
            <IconX />
          </button>
        </div>

        <div className="p-6 space-y-7">
          {/* Contact */}
          <div className="flex flex-wrap gap-3">
            <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100">
              <IconMail /> {lead.email}
            </a>
            {lead.phone && (
              <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                <IconPhone /> {lead.phone}
              </a>
            )}
          </div>

          {/* Source */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">Source</p>
            <p className="text-sm font-semibold text-slate-800">{lead.utm?.source || lead.source || "Direct"}</p>
          </div>

          {/* Message (contact/consultation forms only — the quiz has profile/criteria answers instead) */}
          {lead.message && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Message</p>
              <p className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap">{lead.message}</p>
            </div>
          )}

          {/* Consultation booking */}
          {lead.consultationId && typeof lead.consultationId === "object" && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3.5">
              <p className="text-xs font-bold uppercase tracking-wider text-emerald-700 mb-1.5">Consultation booked</p>
              <p className="text-sm font-semibold text-slate-800">
                {lead.consultationId.startAt
                  ? new Date(lead.consultationId.startAt).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })
                  : "—"}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                {lead.consultationId.locationType === "phone" ? "Phone call" : "Video call"}
                {lead.consultationId.status ? ` · ${lead.consultationId.status}` : ""}
              </p>
            </div>
          )}

          {/* Status + assign */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Status</label>
              <select value={lead.status} onChange={(e) => onUpdateStatus(lead._id, e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5 text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
                {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Assigned to</label>
              <select value={lead.assignedTo?._id || lead.assignedTo || ""} onChange={(e) => onAssign(lead._id, e.target.value || null)}
                className="w-full text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5 text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
                <option value="">Unassigned</option>
                {staffUsers.map((u) => <option key={u._id} value={u._id}>{u.displayName || u.name || u.email}</option>)}
              </select>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => onUpdateStatus(lead._id, "contacted")}
              className="px-3.5 py-2 rounded-xl bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold hover:bg-blue-100 cursor-pointer">
              Mark contacted
            </button>
            <button onClick={() => onUpdateStatus(lead._id, "converted")}
              className="px-3.5 py-2 rounded-xl bg-violet-50 text-violet-700 border border-violet-200 text-xs font-bold hover:bg-violet-100 cursor-pointer">
              Mark converted
            </button>
            <button onClick={() => onUpdateStatus(lead._id, "closed")}
              className="px-3.5 py-2 rounded-xl bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold hover:bg-slate-200 cursor-pointer">
              Close
            </button>
          </div>

          {/* Profile answers */}
          {lead.profileAnswers && Object.keys(lead.profileAnswers).length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Profile</p>
              <div className="rounded-xl border border-slate-100 divide-y divide-slate-100">
                {Object.entries(lead.profileAnswers).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-slate-500 capitalize">{k.replace(/([A-Z])/g, " $1")}</span>
                    <span className="font-semibold text-slate-800">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Evidence strength */}
          {evidence.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Evidence strength</p>
              <div className="space-y-2.5">
                {evidence.map((e) => {
                  const c = criteriaByKey[e.key];
                  const met = c?.met;
                  const developable = c?.developable;
                  return (
                    <div key={e.key} className="flex items-center gap-3">
                      <span className="text-xs text-slate-500 w-36 shrink-0 truncate">{e.key.replace(/_/g, " ")}</span>
                      <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                        <div className={`h-full rounded-full ${met ? "bg-emerald-500" : developable ? "bg-amber-400" : "bg-slate-300"}`}
                          style={{ width: `${((e.value ?? 0) / 3) * 100}%` }} />
                      </div>
                      <span className="text-[0.68rem] text-slate-400 w-16 shrink-0">{e.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Notes</p>
            <div className="space-y-2 mb-3">
              {(lead.notes || []).length === 0 && <p className="text-xs text-slate-400">No notes yet.</p>}
              {(lead.notes || []).map((n, i) => (
                <div key={i} className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
                  <p className="text-sm text-slate-700">{n.text}</p>
                  <p className="text-[0.68rem] text-slate-400 mt-1">{timeAgo(n.createdAt)}</p>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitNote(); }}
                placeholder="Add a note…"
                className="flex-1 text-sm border border-slate-200 rounded-xl px-3.5 py-2.5 outline-none focus:border-emerald-400" />
              <button onClick={submitNote}
                className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer">
                Add
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
