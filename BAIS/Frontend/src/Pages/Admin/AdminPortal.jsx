import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useSocket } from "../../context/SocketContext";
import { adminApi, appointmentsApi, casesApi, leadsApi } from "../../services/api";
import { resolveDisplayVisa } from "../../utils/visaDisplay";
import LeadsSection from "./leads/LeadsInbox";

// super_admin is a HIGHER privilege than admin, not a different one — it must
// never be locked out of the same portal a plain admin can reach (mirrors
// AdminLogin.jsx's ADMIN_PORTAL_ROLES).
const ADMIN_PORTAL_ROLES = ["admin", "super_admin"];
import {
  IconUsers,
  IconCheckCircle,
  IconCalendar,
  IconPassport,
  IconListCheck,
  IconFileText,
  IconCheckmark,
  IconCircle,
} from "../../utils/iconComponents";

/* ── Icons ─────────────────────────────────────────────────────────────────── */
const Ic = {
  Grid:    () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>,
  Users:   () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/></svg>,
  Docs:    () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>,
  Cal:     () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>,
  Logout:  () => <svg width="17" height="17" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>,
  Menu:    () => <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"/></svg>,
  X:       () => <svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>,
  Refresh: () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>,
  Search:  () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>,
  Chevron: () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M19 9l-7 7-7-7"/></svg>,
  Mail:    () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>,
  Phone:   () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 17.72V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 7V5z"/></svg>,
  Check:   () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/></svg>,
  Inbox:   () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12h4l2 3h6l2-3h4M5 5h14l1.5 7v8a1 1 0 01-1 1H4.5a1 1 0 01-1-1v-8L5 5z"/></svg>,
};

/* ── Shared stage config (mirrors Dashboard) ─────────────────────────────────── */
const ADMIN_STAGE_NAMES = [
  "Intake", "Strategy", "Evidence", "Expert Letters",
  "Attorney Review", "Filing", "USCIS Pending", "Approved",
];

const STAGE_COLORS = [
  "bg-emerald-100 text-emerald-700 border-emerald-200",
  "bg-blue-100 text-blue-700 border-blue-200",
  "bg-violet-100 text-violet-700 border-violet-200",
  "bg-amber-100 text-amber-700 border-amber-200",
  "bg-orange-100 text-orange-700 border-orange-200",
  "bg-cyan-100 text-cyan-700 border-cyan-200",
  "bg-purple-100 text-purple-700 border-purple-200",
  "bg-emerald-100 text-emerald-800 border-emerald-300",
];

const VISA_CATEGORIES_ADMIN = ["Work","Family","Student","Temporary","Business","Green Card","Visitor","Self-Sponsored"];

const NAV = [
  { id: "overview",     label: "Overview",     Icon: Ic.Grid  },
  { id: "leads",        label: "Leads",        Icon: Ic.Inbox },
  { id: "cases",        label: "Cases",        Icon: Ic.Docs  },
  { id: "users",        label: "Users",        Icon: Ic.Users },
  { id: "documents",    label: "Documents",    Icon: Ic.Docs  },
  { id: "appointments", label: "Appointments", Icon: Ic.Cal   },
];

const STATUS_COLORS = {
  pending:   "bg-amber-100 text-amber-700 border-amber-200",
  contacted: "bg-blue-100 text-blue-700 border-blue-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

// Aligned to Phase 0's canonical status colors (A=green/complete,
// B=blue/informational, C=amber/action_required, D=gray/not_started).
const TIER_COLORS = {
  A: "bg-emerald-100 text-emerald-700 border-emerald-200",
  B: "bg-blue-100 text-blue-700 border-blue-200",
  C: "bg-amber-100 text-amber-700 border-amber-200",
  D: "bg-slate-100 text-slate-600 border-slate-200",
};

const LEAD_STATUS_COLORS = {
  new:       "bg-amber-100 text-amber-700 border-amber-200",
  contacted: "bg-blue-100 text-blue-700 border-blue-200",
  booked:    "bg-emerald-100 text-emerald-700 border-emerald-200",
  converted: "bg-violet-100 text-violet-700 border-violet-200",
  closed:    "bg-slate-100 text-slate-600 border-slate-200",
};

const VISA_BADGE = {
  "Student Visa (F-1)":        "bg-indigo-100 text-indigo-700",
  "Work Visa (H-1B / L-1)":    "bg-violet-100 text-violet-700",
  "Permanent Visa (Green Card)":"bg-emerald-100 text-emerald-700",
  "Business Visa (B-1/B-2)":   "bg-blue-100 text-blue-700",
  "Family Visa":                "bg-pink-100 text-pink-700",
  "Change of Status":           "bg-orange-100 text-orange-700",
  "Temporary Visa":             "bg-teal-100 text-teal-700",
};

const DOC_LABELS = [
  "Passport",
  "Visa Application Form",
  "Academic Transcripts",
  "Financial Proof",
  "Employment Documents",
  "Photographs",
  "Sponsor Letter",
  "Medical Records",
];

function fmt(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function initials(name) {
  if (!name) return "?";
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/* ── Stat Card ──────────────────────────────────────────────────────────────── */
function StatCard({ label, value, sub, color, icon: Icon, iconColor = "text-slate-600" }) {
  return (
    <div className={`bg-white rounded-2xl p-6 border border-slate-100 shadow-sm hover:shadow-md transition-all duration-200`}>
      <div className="flex items-start justify-between mb-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${color}`}><Icon size={22} className={iconColor} /></div>
      </div>
      <p className="text-3xl font-extrabold text-slate-900 mb-1">{value}</p>
      <p className="text-sm font-semibold text-slate-600">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

/* ── Badge ──────────────────────────────────────────────────────────────────── */
function Badge({ text, className = "" }) {
  return (
    <span className={`inline-block text-[0.7rem] font-bold px-2.5 py-1 rounded-full border ${className}`}>
      {text}
    </span>
  );
}

/* ── Expandable User Row ─────────────────────────────────────────────────────── */
function UserRow({ u, idx, expanded, onToggle }) {
  const profile = u.profile || {};
  const caseData = u.case || {};
  const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || u.displayName || "Unknown";
  const addr = [profile.address, profile.city, profile.state, profile.country].filter(Boolean).join(", ");
  const visaType = caseData.visaType || profile.visaType;
  const visaBadge = VISA_BADGE[visaType] || "bg-slate-100 text-slate-600";

  return (
    <>
      <tr className={`border-b border-slate-100 hover:bg-slate-50 transition-colors cursor-pointer
        ${expanded ? "bg-emerald-50/50" : ""}`}
        onClick={onToggle}>
        <td className="px-5 py-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
              flex items-center justify-center text-white text-xs font-extrabold shrink-0`}>
              {initials(name)}
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800 leading-tight">{name || "—"}</p>
              <p className="text-xs text-slate-400">{u.email || "—"}</p>
            </div>
          </div>
        </td>
        <td className="px-5 py-4 text-sm text-slate-600 hidden sm:table-cell">{profile.primaryPhone || "—"}</td>
        <td className="px-5 py-4 hidden md:table-cell">
          {visaType
            ? <span className={`text-[0.7rem] font-bold px-2.5 py-1 rounded-full ${visaBadge}`}>{visaType}</span>
            : <span className="text-xs text-slate-400">—</span>}
        </td>
        <td className="px-5 py-4 hidden lg:table-cell text-xs text-slate-500">{profile.nationality || "—"}</td>
        <td className="px-5 py-4 hidden lg:table-cell text-xs text-slate-500">{fmt(u.createdAt)}</td>
        <td className="px-5 py-4 text-right">
          <span className={`text-slate-400 inline-block transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}>
            <Ic.Chevron />
          </span>
        </td>
      </tr>

      {expanded && (
        <tr className="bg-slate-50/80 border-b border-slate-100">
          <td colSpan="6" className="px-6 py-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">

              <DetailGroup title="Personal Info" items={[
                ["Full Name", name],
                ["Date of Birth", profile.dateOfBirth || "—"],
                ["Nationality", profile.nationality || "—"],
                ["Gender", profile.gender || "—"],
                ["Marital Status", profile.maritalStatus || "—"],
              ]} />

              <DetailGroup title="Contact" items={[
                ["Email", u.email || "—"],
                ["Primary Phone", profile.primaryPhone || "—"],
                ["WhatsApp", profile.whatsappNumber || "—"],
                ["Emergency Contact", profile.emergencyName ? `${profile.emergencyName} (${profile.emergencyPhone || "—"})` : "—"],
              ]} />

              <DetailGroup title="Address" items={[
                ["Street", profile.address || "—"],
                ["City", profile.city || "—"],
                ["State / Province", profile.state || "—"],
                ["Zip / Postal", profile.zipCode || "—"],
                ["Country", profile.country || "—"],
              ]} />

              <DetailGroup title="Visa & Case" items={[
                ["Visa Type", visaType || "—"],
                ["Case ID", caseData.caseId || "—"],
                ["USCIS No.", caseData.uscisNumber || "Pending"],
                ["Priority", caseData.priority || "—"],
              ]} />

              <DetailGroup title="Citizenship" items={[
                ["Country of Birth", profile.countryOfBirth || "—"],
                ["Country of Citizenship", profile.countryOfCitizenship || "—"],
                ["Native Language", profile.nativeLanguage || "—"],
              ]} />

              <DetailGroup title="Legal History" items={[
                ["Criminal Record", profile.criminalRecord || "—"],
                ["Visa Denial", profile.visaDenial || "—"],
                ["Deportation", profile.deportation || "—"],
              ]} />
            </div>

            {false && (
              <div className="mt-4 pt-4 border-t border-slate-200">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Sponsor</p>
                <p className="text-sm text-slate-700">
                  {u.sponsorName} · {u.sponsorRelation || "—"} · {u.sponsorPhone || "—"} · {u.sponsorEmail || "—"}
                </p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function DetailGroup({ title, items }) {
  return (
    <div>
      <p className="text-[0.68rem] font-bold text-slate-400 uppercase tracking-widest mb-2">{title}</p>
      <div className="space-y-1.5">
        {items.map(([label, value]) => (
          <div key={label} className="flex gap-2">
            <span className="text-xs text-slate-400 w-28 shrink-0">{label}</span>
            <span className="text-xs font-semibold text-slate-700 truncate">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Cases Section ───────────────────────────────────────────────────────────── */
function CasesSection({ cases, onUpdateStage }) {
  const [search,         setSearch]         = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus,   setFilterStatus]   = useState("all");
  const [expandedId,     setExpandedId]     = useState(null);
  const [stageNote,      setStageNote]      = useState("");

  const filtered = cases.filter((c) => {
    const q   = search.toLowerCase();
    const usr = c.user || {};
    const matchSearch = !q
      || (c.caseId || "").toLowerCase().includes(q)
      || (usr.displayName || "").toLowerCase().includes(q)
      || (usr.email || "").toLowerCase().includes(q)
      || (c.visaType || "").toLowerCase().includes(q);
    const matchCat    = filterCategory === "all" || c.visaCategory === filterCategory;
    const matchStatus = filterStatus   === "all" || c.status      === filterStatus;
    return matchSearch && matchCat && matchStatus;
  });

  const handleAdvance = async (caseId, caseData) => {
    const next = Math.min((caseData.currentStage || 0) + 1, ADMIN_STAGE_NAMES.length - 1);
    await onUpdateStage(caseId, next, stageNote);
    setStageNote("");
    setExpandedId(null);
  };

  const handleSetStage = async (caseId, stage) => {
    await onUpdateStage(caseId, stage, stageNote);
    setStageNote("");
    setExpandedId(null);
  };

  return (
    <div className="space-y-6">
      {/* Header + filters */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 mb-1">Case Management</h2>
          <p className="text-sm text-slate-500">{cases.length} total cases · {filtered.length} shown</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Ic.Search /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cases…"
              className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white
                text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all w-44 sm:w-52"/>
          </div>
          <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5 text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
            <option value="all">All Categories</option>
            {VISA_CATEGORIES_ADMIN.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5 text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm py-16 text-center">
          <IconListCheck size={40} className="text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 text-sm">No cases found{search ? ` for "${search}"` : ""}.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => {
            const usr       = c.user || {};
            const name      = usr.displayName || usr.email?.split("@")[0] || "Unknown";
            const stage     = c.currentStage ?? 0;
            const stageName = ADMIN_STAGE_NAMES[stage] || "Unknown";
            const stageCls  = STAGE_COLORS[stage] || STAGE_COLORS[0];
            const isExp     = expandedId === c._id;

            return (
              <div key={c._id} className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Row */}
                <div className="flex flex-wrap items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50 transition"
                  onClick={() => setExpandedId(isExp ? null : c._id)}>
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
                    flex items-center justify-center text-white text-xs font-extrabold shrink-0">
                    {initials(name)}
                  </div>
                  {/* Name + Case ID */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 leading-tight">{name}</p>
                    <p className="text-xs text-slate-400">{c.caseId}</p>
                  </div>
                  {/* Visa */}
                  <div className="hidden sm:block text-right min-w-0">
                    {c.visaCategory && (
                      <p className="text-[0.68rem] font-bold text-slate-500">{c.visaCategory}</p>
                    )}
                    <p className="text-xs font-bold text-slate-800">{resolveDisplayVisa(c)}</p>
                  </div>
                  {/* Stage badge */}
                  <span className={`text-[0.7rem] font-bold px-2.5 py-1 rounded-full border ${stageCls}`}>
                    {stage + 1}. {stageName}
                  </span>
                  {/* Status */}
                  <span className={`text-[0.68rem] font-bold px-2.5 py-1 rounded-full border ${
                    c.status === "active" ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : c.status === "on_hold" ? "bg-amber-50 text-amber-700 border-amber-200"
                    : c.status === "completed" ? "bg-slate-100 text-slate-600 border-slate-200"
                    : "bg-red-50 text-red-600 border-red-200"
                  }`}>
                    {c.status?.replace("_", " ")}
                  </span>
                  <span className={`text-slate-400 transition-transform duration-200 ${isExp ? "rotate-180" : ""}`}>
                    <Ic.Chevron />
                  </span>
                </div>

                {/* Expanded stage management panel */}
                {isExp && (
                  <div className="border-t border-slate-100 px-5 py-4 bg-slate-50/60 space-y-4">
                    {/* Stage history */}
                    {(c.stageHistory || []).length > 0 && (
                      <div>
                        <p className="text-[0.68rem] font-bold text-slate-400 uppercase tracking-widest mb-2">Stage History</p>
                        <div className="flex flex-wrap gap-2">
                          {c.stageHistory.map((h, i) => (
                            <span key={i} className={`text-[0.65rem] font-bold px-2 py-0.5 rounded-full border ${STAGE_COLORS[h.stage] || STAGE_COLORS[0]}`}>
                              {h.stageName} · {new Date(h.enteredAt).toLocaleDateString()}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Advance stage controls */}
                    <div>
                      <p className="text-[0.68rem] font-bold text-slate-400 uppercase tracking-widest mb-2">Advance Stage</p>
                      <div className="flex flex-wrap gap-2">
                        {ADMIN_STAGE_NAMES.map((sn, i) => (
                          <button key={i}
                            disabled={i === stage}
                            onClick={() => handleSetStage(c._id, i)}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed
                              ${i === stage
                                ? "bg-emerald-100 text-emerald-700 border-emerald-300"
                                : i < stage
                                  ? "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
                                  : "bg-white text-slate-600 border-slate-200 hover:border-emerald-400 hover:text-emerald-700"}`}>
                            {i + 1}. {sn}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Optional note + quick advance */}
                    <div className="flex flex-wrap items-center gap-3">
                      <input
                        value={stageNote}
                        onChange={(e) => setStageNote(e.target.value)}
                        placeholder="Optional note for stage change…"
                        className="flex-1 min-w-48 px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white
                          text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition"/>
                      {stage < ADMIN_STAGE_NAMES.length - 1 && (
                        <button onClick={() => handleAdvance(c._id, c)}
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700
                            text-white text-xs font-bold rounded-lg transition active:scale-95 cursor-pointer">
                          <Ic.Check /> Advance to {ADMIN_STAGE_NAMES[stage + 1]}
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Overview Section ────────────────────────────────────────────────────────── */
function OverviewSection({ users, appointments, overview }) {
  const stats = overview?.stats || {};

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-extrabold text-slate-900 mb-1">Overview</h2>
        <p className="text-sm text-slate-500">Welcome back, Admin. Here's what's happening today.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Registered Users" value={stats.totalUsers ?? users.length} icon={IconUsers} iconColor="text-emerald-600"
          sub="Active accounts" color="bg-emerald-50" />
        <StatCard label="Complete Profiles" value={stats.completedProfiles ?? 0} icon={IconCheckCircle} iconColor="text-blue-600"
          sub={`${stats.incompleteProfiles ?? 0} incomplete`} color="bg-blue-50" />
        <StatCard label="Total Appointments" value={stats.totalAppointments ?? appointments.length} icon={IconCalendar} iconColor="text-amber-600"
          sub={`${stats.pendingAppointments ?? 0} pending`} color="bg-amber-50" />
        <StatCard label="Active Cases" value={overview?.stats?.activeCases ?? 0} icon={IconPassport} iconColor="text-violet-600"
          sub="Cases in progress" color="bg-violet-50" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Recent Users */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-extrabold text-slate-800 text-sm">Recent Registrations</h3>
            <span className="text-xs text-slate-400">{stats.totalUsers ?? 0} total</span>
          </div>
          {(overview?.recentUsers || []).length === 0
            ? <p className="px-6 py-8 text-sm text-slate-400 text-center">No users registered yet.</p>
            : (
              <div className="divide-y divide-slate-100">
                {(overview?.recentUsers || []).map((u) => {
                  const name = u.displayName || u.email?.split("@")[0] || "Unknown";
                  return (
                    <div key={u._id} className="flex items-center gap-3 px-6 py-3.5">
                      <div className="w-8 h-8 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
                        flex items-center justify-center text-white text-xs font-extrabold shrink-0">
                        {initials(name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{name}</p>
                        <p className="text-xs text-slate-400 truncate">{u.email || "—"}</p>
                      </div>
                      <span className="text-xs text-slate-400 shrink-0">{fmt(u.createdAt)}</span>
                    </div>
                  );
                })}
              </div>
            )}
        </div>

        {/* Recent Appointments */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h3 className="font-extrabold text-slate-800 text-sm">Recent Appointments</h3>
            <span className="text-xs text-slate-400">{stats.totalAppointments ?? 0} total</span>
          </div>
          {(overview?.recentAppointments || []).length === 0
            ? <p className="px-6 py-8 text-sm text-slate-400 text-center">No appointments submitted yet.</p>
            : (
              <div className="divide-y divide-slate-100">
                {(overview?.recentAppointments || []).map((a) => (
                    <div key={a._id} className="flex items-center gap-3 px-6 py-3.5">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center
                        text-slate-600 text-xs font-extrabold shrink-0">
                        {initials(a.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{a.name}</p>
                        <p className="text-xs text-slate-400 truncate">{a.visaType || "Not specified"}</p>
                      </div>
                      <Badge text={a.status} className={STATUS_COLORS[a.status] || STATUS_COLORS.pending} />
                    </div>
                  ))}
              </div>
            )}
        </div>

      </div>

      {/* Visa breakdown */}
      {users.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
          <h3 className="font-extrabold text-slate-800 text-sm mb-5">Visa Type Breakdown</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {Object.entries(
              users.reduce((acc, u) => {
                const v = u.visaType || "Not Specified";
                acc[v] = (acc[v] || 0) + 1;
                return acc;
              }, {})
            ).map(([visa, count]) => (
              <div key={visa} className={`rounded-xl p-4 border ${VISA_BADGE[visa] ? VISA_BADGE[visa].replace("text-", "border-").replace("bg-", "bg-").replace("100 ", "100 border-") : "bg-slate-50 border-slate-200"}`}>
                <p className="text-2xl font-extrabold mb-1">{count}</p>
                <p className="text-xs font-semibold leading-tight">{visa}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Users Section ───────────────────────────────────────────────────────────── */
function UsersSection({ users }) {
  const [search, setSearch] = useState("");
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [filter, setFilter] = useState("all");

  const visaTypes = [...new Set(users.map(u => u.case?.visaType).filter(Boolean))];

  const filtered = users.filter((u) => {
    const profile = u.profile || {};
    const name = [profile.firstName, profile.lastName].filter(Boolean).join(" ").toLowerCase();
    const visaType = u.case?.visaType || "";
    const q = search.toLowerCase();
    const matchSearch = !q || name.includes(q) || (u.email || "").toLowerCase().includes(q) || visaType.toLowerCase().includes(q);
    const matchFilter = filter === "all" || visaType === filter;
    return matchSearch && matchFilter;
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 mb-1">Registered Users</h2>
          <p className="text-sm text-slate-500">{users.length} total users · {filtered.length} shown</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Ic.Search /></span>
            <input value={search} onChange={(e) => { setSearch(e.target.value); setExpandedIdx(null); }}
              placeholder="Search users…"
              className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white
                text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all w-48 sm:w-56"/>
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5
              text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
            <option value="all">All Visa Types</option>
            {visaTypes.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="py-16 text-center">
            <IconUsers size={40} className="text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500 text-sm">No users found{search ? ` for "${search}"` : ""}.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100">
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">User</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Phone</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden md:table-cell">Visa Type</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Nationality</th>
                  <th className="px-5 py-3.5 text-left text-xs font-bold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Joined</th>
                  <th className="px-5 py-3.5"/>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, i) => (
                  <UserRow key={i} u={u} idx={i}
                    expanded={expandedIdx === i}
                    onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Documents Section ───────────────────────────────────────────────────────── */
function DocumentsSection({ users }) {
  const [search, setSearch] = useState("");

  const filtered = users.filter((entry) => {
    const u = entry.user || entry;
    const name = (u.displayName || u.email || "").toLowerCase();
    return !search || name.includes(search.toLowerCase()) || (u.email || "").toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 mb-1">Document Status</h2>
          <p className="text-sm text-slate-500">Track which documents each user has submitted.</p>
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Ic.Search /></span>
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search users…"
            className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white
              text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all w-48 sm:w-56"/>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm py-16 text-center">
          <IconFileText size={40} className="text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 text-sm">No users found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((entry, i) => {
            const u = entry.user || entry;
            const name = u.displayName || u.email?.split("@")[0] || "Unknown";
            const docs = entry.documents || [];
            const submitted = docs.length;
            // Visa-specific required list resolved server-side for this user's active
            // case; falls back to the generic labels only when no case/visa is on file yet.
            const requiredDocuments = entry.requiredDocuments?.length ? entry.requiredDocuments : DOC_LABELS.map((name) => ({ name }));
            const total = requiredDocuments.length;

            return (
              <div key={u._id || i} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
                    flex items-center justify-center text-white text-xs font-extrabold shrink-0">
                    {initials(name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-800 text-sm">{name}</p>
                    <p className="text-xs text-slate-400 truncate">{u.email || "—"}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-extrabold text-slate-900">{submitted}/{total}</p>
                    <p className="text-xs text-slate-400">submitted</p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full h-1.5 bg-slate-100 rounded-full mb-4 overflow-hidden">
                  <div className="h-full bg-linear-to-r from-[#1D9E75] to-teal-500 rounded-full transition-all duration-500"
                    style={{ width: `${Math.min((submitted / total) * 100, 100)}%` }} />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {requiredDocuments.map((doc) => {
                    const hasDoc = doc.documentType
                      ? docs.some((d) => d.documentType === doc.documentType)
                      : docs.some((d) => (d.documentType || "").toLowerCase().includes(doc.name.toLowerCase().split(" ")[0]));
                    return (
                      <div key={doc.documentType || doc.name} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold
                        ${hasDoc ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-50 text-slate-400 border border-slate-200"}`}>
                        {hasDoc ? <IconCheckmark size={12} className="text-emerald-700 shrink-0" /> : <IconCircle size={12} className="text-slate-300 shrink-0" />}
                        <span className="truncate">{doc.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Appointments Section ────────────────────────────────────────────────────── */
function AppointmentsSection({ appointments, onUpdateStatus }) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");

  const filtered = appointments.filter((a) => {
    const q = search.toLowerCase();
    const matchSearch = !q || (a.name || "").toLowerCase().includes(q) || (a.email || "").toLowerCase().includes(q);
    const matchStatus = filterStatus === "all" || a.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const counts = appointments.reduce((acc, a) => {
    acc[a.status] = (acc[a.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-slate-900 mb-1">Appointment Requests</h2>
          <p className="text-sm text-slate-500">{appointments.length} total · {counts.pending || 0} pending</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Ic.Search /></span>
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="pl-9 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl bg-white
                text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 transition-all w-40 sm:w-48"/>
          </div>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
            className="text-sm border border-slate-200 rounded-xl bg-white px-3 py-2.5
              text-slate-700 outline-none focus:border-emerald-400 cursor-pointer">
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="contacted">Contacted</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>

      {/* Status summary chips */}
      <div className="flex gap-3 flex-wrap">
        {[["pending","Pending",STATUS_COLORS.pending],["contacted","Contacted",STATUS_COLORS.contacted],["completed","Completed",STATUS_COLORS.completed]]
          .map(([s, l, c]) => (
            <button key={s} onClick={() => setFilterStatus(filterStatus === s ? "all" : s)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer
                ${filterStatus === s ? c + " shadow-sm" : "bg-white border-slate-200 text-slate-500 hover:border-slate-300"}`}>
              <span>{counts[s] || 0}</span> {l}
            </button>
          ))}
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm py-16 text-center">
          <IconCalendar size={40} className="text-slate-300 mx-auto mb-4" />
          <p className="text-slate-500 text-sm">No appointments found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {[...filtered].sort((a, b) => new Date(b.createdAt || b.submittedAt || 0) - new Date(a.createdAt || a.submittedAt || 0))
            .map((appt) => (
              <div key={appt._id || appt.id}
                className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5
                  hover:shadow-md transition-all duration-200">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-linear-to-br from-slate-600 to-slate-800
                      flex items-center justify-center text-white text-xs font-extrabold shrink-0">
                      {initials(appt.name)}
                    </div>
                    <div>
                      <p className="font-extrabold text-slate-800">{appt.name}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                        <span className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Ic.Mail /> {appt.email}
                        </span>
                        <span className="flex items-center gap-1.5 text-xs text-slate-500">
                          <Ic.Phone /> {appt.phone}
                        </span>
                      </div>
                      {(appt.visaType || appt.visa) && (
                        <span className={`inline-block mt-2 text-[0.68rem] font-bold px-2.5 py-1 rounded-full ${VISA_BADGE[appt.visaType || appt.visa] || "bg-slate-100 text-slate-600"}`}>
                          {appt.visaType || appt.visa}
                        </span>
                      )}
                      {appt.message && (
                        <p className="mt-2 text-xs text-slate-500 leading-relaxed max-w-lg bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                          "{appt.message}"
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-3 shrink-0">
                    <Badge text={appt.status} className={STATUS_COLORS[appt.status] || STATUS_COLORS.pending} />
                    <p className="text-xs text-slate-400">{fmt(appt.createdAt || appt.submittedAt)}</p>
                    <div className="flex gap-2">
                      {appt.status !== "contacted" && (
                        <button onClick={() => onUpdateStatus(appt._id, "contacted")}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700
                            border border-blue-200 hover:bg-blue-100 transition cursor-pointer">
                          Mark Contacted
                        </button>
                      )}
                      {appt.status !== "completed" && (
                        <button onClick={() => onUpdateStatus(appt._id, "completed")}
                          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700
                            border border-emerald-200 hover:bg-emerald-100 transition cursor-pointer">
                          Mark Done
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/* ── Main Portal ─────────────────────────────────────────────────────────────── */
export default function AdminPortal() {
  const { user, authLoading, logout } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();
  const [section, setSection]         = useState("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [users, setUsers]             = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [leads, setLeads]             = useState([]);
  const [lastRefresh, setLastRefresh]  = useState(null);

  useEffect(() => {
    document.title = "Admin Portal | BAIS";
  }, []);

  const [overview, setOverview]   = useState(null);
  const [docOverview, setDocOverview] = useState([]);
  const [cases, setCases]         = useState([]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !ADMIN_PORTAL_ROLES.includes(user.role)) navigate("/admin");
  }, [user, authLoading]);

  const loadData = useCallback(async () => {
    try {
      const [ov, userRes, apptRes, docsRes, casesRes, leadsRes] = await Promise.all([
        adminApi.overview(),
        adminApi.users(),
        appointmentsApi.all(),
        adminApi.documents(),
        casesApi.all({ limit: 100 }),
        leadsApi.list({ limit: 200 }),
      ]);
      setOverview(ov);
      setUsers(userRes.users || []);
      setAppointments(apptRes.appointments || []);
      setDocOverview(docsRes || []);
      setCases(casesRes.cases || []);
      setLeads(leadsRes.items || []);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Failed to load admin data", err);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Live inbox updates — a custom "lead:created" event (carrying the full
  // Lead document, not just a notification) so a new submission prepends
  // instantly with zero refetch, mirroring how NotificationBell.jsx already
  // patches its own list from socket events rather than reloading.
  useEffect(() => {
    if (!socket) return undefined;
    const onLeadCreated = (lead) => {
      setLeads((prev) => (prev.some((l) => l._id === lead._id) ? prev : [lead, ...prev]));
    };
    // Fired when an existing lead changes after the initial page load — e.g.
    // booking a consultation flips status to "booked" and sets
    // consultationId — so an already-open Leads Inbox reflects it live.
    const onLeadUpdated = (lead) => {
      setLeads((prev) => (prev.some((l) => l._id === lead._id) ? prev.map((l) => (l._id === lead._id ? lead : l)) : [lead, ...prev]));
    };
    socket.on("lead:created", onLeadCreated);
    socket.on("lead:updated", onLeadUpdated);
    return () => {
      socket.off("lead:created", onLeadCreated);
      socket.off("lead:updated", onLeadUpdated);
    };
  }, [socket]);

  const handleMarkLeadSeen = async (id) => {
    try {
      const res = await leadsApi.markSeen(id);
      setLeads((prev) => prev.map((l) => (l._id === id ? res.data : l)));
    } catch { /* non-fatal — the highlight just stays until next refresh */ }
  };

  const handleUpdateLeadStatus = async (id, status) => {
    try {
      const res = await leadsApi.updateStatus(id, status);
      setLeads((prev) => prev.map((l) => (l._id === id ? res.data : l)));
    } catch (err) {
      alert("Failed to update lead status: " + err.message);
    }
  };

  const handleAssignLead = async (id, userId) => {
    try {
      const res = await leadsApi.assign(id, userId);
      setLeads((prev) => prev.map((l) => (l._id === id ? res.data : l)));
    } catch (err) {
      alert("Failed to assign lead: " + err.message);
    }
  };

  const handleAddLeadNote = async (id, text) => {
    try {
      const res = await leadsApi.addNote(id, text);
      setLeads((prev) => prev.map((l) => (l._id === id ? res.data : l)));
    } catch (err) {
      alert("Failed to add note: " + err.message);
    }
  };

  const handleUpdateAppointmentStatus = async (id, status) => {
    try {
      const res = await appointmentsApi.updateStatus(id, status);
      setAppointments((prev) => prev.map((a) => a._id === id ? res.appointment : a));
    } catch (err) {
      alert("Failed to update status: " + err.message);
    }
  };

  const handleUpdateCaseStage = async (id, stage, note) => {
    try {
      const res = await casesApi.update(id, { currentStage: stage, stageNote: note });
      setCases((prev) => prev.map((c) => c._id === id ? res.case : c));
    } catch (err) {
      alert("Failed to update case stage: " + err.message);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate("/", { replace: true });
  };

  const displayName = user?.displayName || user?.email?.split("@")[0] || "Admin";
  const ins = displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="w-10 h-10 rounded-full border-4 border-emerald-700 border-t-emerald-400 animate-spin" />
      </div>
    );
  }

  const SidebarContent = () => (
    <>
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-6 border-b border-slate-800">
        <div className="w-9 h-9 rounded-xl bg-linear-to-br from-[#1D9E75] to-teal-600
          flex items-center justify-center shadow-md shrink-0">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
          </svg>
        </div>
        <div>
          <p className="text-sm font-extrabold text-white leading-none">BAIS</p>
          <p className="text-[0.6rem] font-bold uppercase tracking-widest text-emerald-400">Admin Portal</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV.map(({ id, label, Icon }) => (
          <button key={id}
            onClick={() => { setSection(id); setSidebarOpen(false); }}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold
              transition-all duration-150 cursor-pointer text-left
              ${section === id
                ? "bg-emerald-600/20 text-emerald-400 border border-emerald-600/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}>
            <Icon />
            {label}
            {id === "cases" && cases.filter(c => c.status === "active").length > 0 && (
              <span className="ml-auto bg-emerald-500 text-white text-[0.6rem] font-extrabold
                px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                {cases.filter(c => c.status === "active").length}
              </span>
            )}
            {id === "appointments" && appointments.filter(a => a.status === "pending").length > 0 && (
              <span className="ml-auto bg-amber-500 text-white text-[0.6rem] font-extrabold
                px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                {appointments.filter(a => a.status === "pending").length}
              </span>
            )}
            {id === "leads" && leads.filter(l => !l.seenAt).length > 0 && (
              <span className="ml-auto bg-amber-500 text-white text-[0.6rem] font-extrabold
                px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center">
                {leads.filter(l => !l.seenAt).length}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Admin info */}
      <div className="px-4 py-4 border-t border-slate-800">
        <div className="flex items-center gap-3 px-3 py-3 rounded-xl bg-slate-800 mb-2">
          <div className="w-8 h-8 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
            flex items-center justify-center text-white text-xs font-extrabold shrink-0">
            {ins}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-white truncate">{displayName}</p>
            <p className="text-[0.6rem] text-slate-400 truncate">{user?.email}</p>
          </div>
        </div>
        <button onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm font-semibold
            text-red-400 hover:bg-red-500/10 transition cursor-pointer">
          <Ic.Logout /> Sign Out
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">

      {/* ── Desktop Sidebar ── */}
      <aside className="hidden md:flex w-64 shrink-0 flex-col bg-slate-900 border-r border-slate-800">
        <SidebarContent />
      </aside>

      {/* ── Mobile Sidebar Overlay ── */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
          <aside className="relative w-72 flex flex-col bg-slate-900 border-r border-slate-800 shadow-2xl z-10">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* ── Main Area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-5 shrink-0 shadow-sm">
          <div className="flex items-center gap-4">
            <button onClick={() => setSidebarOpen(true)}
              className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-100 transition cursor-pointer">
              <Ic.Menu />
            </button>
            <div>
              <h1 className="text-base font-extrabold text-slate-900 capitalize leading-tight">
                {NAV.find(n => n.id === section)?.label || "Overview"}
              </h1>
              {lastRefresh && (
                <p className="text-[0.65rem] text-slate-400">
                  Last refreshed {lastRefresh.toLocaleTimeString()}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={loadData}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200
                text-sm font-semibold text-slate-600 hover:bg-slate-50 transition cursor-pointer">
              <Ic.Refresh /> <span className="hidden sm:inline">Refresh</span>
            </button>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-emerald-700 hidden sm:inline">Admin</span>
            </div>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-5 sm:p-7">
          {section === "overview" && <OverviewSection users={users} appointments={appointments} overview={overview} />}
          {section === "cases" && <CasesSection cases={cases} onUpdateStage={handleUpdateCaseStage} />}
          {section === "users" && <UsersSection users={users} />}
          {section === "documents" && <DocumentsSection users={docOverview} />}
          {section === "leads" && (
            <LeadsSection
              leads={leads}
              users={users}
              onMarkSeen={handleMarkLeadSeen}
              onUpdateStatus={handleUpdateLeadStatus}
              onAssign={handleAssignLead}
              onAddNote={handleAddLeadNote}
            />
          )}
          {section === "appointments" && (
            <AppointmentsSection appointments={appointments} onUpdateStatus={handleUpdateAppointmentStatus} />
          )}
        </main>
      </div>
    </div>
  );
}
