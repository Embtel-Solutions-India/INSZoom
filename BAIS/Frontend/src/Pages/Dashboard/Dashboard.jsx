import { useState, useEffect, useCallback } from "react";
import InfoPopup from "../../components/InfoPopup";
import { paymentsApi } from "../../services/api";
import { VISA_CATEGORIES, VISA_TYPES, VISA_DETAILS } from "../../config/visaConfig";
import { resolveDisplayVisa } from "../../utils/visaDisplay";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isEmployeeAccount } from "../../utils/auth";
import { profileApi, casesApi, documentsApi, messagesApi } from "../../services/api";
import { PLAN_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS } from "../../config/planConfig";
import useCaseDocumentChecklist from "../../hooks/useCaseDocumentChecklist";
import { buildCaseCategories } from "../../components/DocumentChecklist";

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—";

const daysAgo = (iso) => {
  if (!iso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(iso)) / 86400000));
};

const daysUntil = (iso) => {
  if (!iso) return null;
  const d = Math.ceil((new Date(iso) - Date.now()) / 86400000);
  return d;
};

/* ── Icons ──────────────────────────────────────────────────────────────────── */
const Ic = {
  User:     () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/></svg>,
  Docs:     () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>,
  Calendar: () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>,
  Clock:    () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>,
  Check:    () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7"/></svg>,
  Alert:    () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>,
  Info:     () => <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>,
  Globe:    () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>,
  Agent:    () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>,
  Star:     () => <svg width="16" height="16" fill="currentColor"  viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
  Mail:     () => <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>,
  Phone:    () => <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498A1 1 0 0121 17.72V19a2 2 0 01-2 2H17C9.716 21 3 14.284 3 7V5z"/></svg>,
  Arrow:    () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 5l7 7-7 7"/></svg>,
  Upload:   () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>,
  Shield:   () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>,
  Passport: () => <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0"/></svg>,
  Up:       () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19V5m0 0l-7 7m7-7l7 7"/></svg>,
  X:        () => <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12"/></svg>,
};

/* ── Case stages config — 8-stage INSZoom-style workflow ────────────────────── */
const CASE_STAGES = [
  { id: 0, label: "Intake",          sub: "Case intake & assessment",     icon: Ic.User,     color: "#1D9E75" },
  { id: 1, label: "Strategy",        sub: "Legal strategy planning",      icon: Ic.Globe,    color: "#3b82f6" },
  { id: 2, label: "Evidence",        sub: "Gathering supporting evidence", icon: Ic.Docs,     color: "#8b5cf6" },
  { id: 3, label: "Expert Letters",  sub: "Expert recommendation letters", icon: Ic.Mail,     color: "#f59e0b" },
  { id: 4, label: "Attorney Review", sub: "Attorney case review",          icon: Ic.Shield,   color: "#f97316" },
  { id: 5, label: "Filing",          sub: "USCIS petition filing",         icon: Ic.Upload,   color: "#06b6d4" },
  { id: 6, label: "USCIS Pending",   sub: "Under USCIS review",            icon: Ic.Clock,    color: "#a855f7" },
  { id: 7, label: "Approved",        sub: "Case approved!",                icon: Ic.Star,     color: "#1D9E75" },
];

const CRM_STAGE_INDEX = {
  intake: 0,
  pending_assignment: 0,
  assigned: 0,
  strategy: 1,
  evidence: 2,
  document_collection: 2,
  expert_letters: 3,
  attorney_review: 4,
  filing: 5,
  ready_to_file: 5,
  filed: 6,
  uscis_pending: 6,
  in_processing: 6,
  approved: 7,
  completed: 7,
  closed: 7,
};

const normalizeCaseStage = (caseData) => {
  const explicitStage = Number(caseData?.currentStage);
  if (Number.isFinite(explicitStage)) return Math.max(0, Math.min(explicitStage, CASE_STAGES.length - 1));
  const key = String(caseData?.stage || caseData?.status || "").toLowerCase();
  return CRM_STAGE_INDEX[key] ?? 0;
};

/* ── Announcements ──────────────────────────────────────────────────────────── */
const ANNOUNCEMENTS = [
  {
    id: 1,
    title: "F-1 Visa Interview Slots Now Available",
    body: "US Embassy Mumbai has released new interview slots for June–July 2025. Book early to secure your preferred date.",
    date: "Apr 15, 2025",
    tag: "Visa Update",
    tagColor: "bg-blue-100 text-blue-700",
    urgent: false,
  },
  {
    id: 2,
    title: "New USCIS Processing Time Updates",
    body: "USCIS has revised estimated processing times for H-1B petitions to 3–5 months for standard processing.",
    date: "Apr 10, 2025",
    tag: "Policy Update",
    tagColor: "bg-violet-100 text-violet-700",
    urgent: false,
  },
  {
    id: 3,
    title: "Document Checklist Reminder",
    body: "Ensure all required documents are uploaded before your assigned deadline to avoid processing delays.",
    date: "Today",
    tag: "Action Required",
    tagColor: "bg-red-100 text-red-700",
    urgent: true,
  },
];

/* ── Circular Progress ──────────────────────────────────────────────────────── */
function CircularProgress({ pct, size = 72, stroke = 7, color = "#1D9E75", children }) {
  const r    = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = Math.min(pct, 100) / 100 * circ;
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute top-0 left-0">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 1s ease" }} />
      </svg>
      <div className="relative z-10 text-center">{children}</div>
    </div>
  );
}

/* ── KPI Card ───────────────────────────────────────────────────────────────── */
/* compact=true → smaller icon, lighter text — used for text-based info cards  */
function KpiCard({ icon, label, value, sub, color, progress, circPct, circColor, barColor, compact }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
      {circPct !== undefined ? (
        <CircularProgress pct={circPct} size={60} stroke={6} color={circColor || "#1D9E75"}>
          <span className="text-[0.65rem] font-extrabold text-slate-700">{circPct}%</span>
        </CircularProgress>
      ) : (
        <div className={`${compact ? "w-9 h-9 rounded-lg" : "w-11 h-11 rounded-xl"} flex items-center justify-center shrink-0 ${color}`}>
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[0.68rem] font-semibold uppercase tracking-wider text-slate-400 truncate">{label}</p>
        {compact
          ? <p className="text-sm font-semibold text-slate-700 leading-snug mt-0.5 truncate">{value}</p>
          : <p className="text-xl font-extrabold text-slate-800 leading-tight mt-0.5 truncate">{value}</p>
        }
        {sub && <p className="text-[0.7rem] text-slate-400 mt-0.5 truncate">{sub}</p>}
        {progress !== undefined && (
          <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-1000 ${barColor || "bg-emerald-500"}`}
              style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
function moneyFromCents(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);
}

function UpgradeServicesCard({ addons, purchased = [], loading, purchasing, error, onPurchase }) {
  const premium = addons.find((item) => item.key === "premium_processing_i907");
  const purchasedPremium = purchased.find((item) => item.key === "premium_processing_i907");
  if (!premium && !purchasedPremium && !loading) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[0.72rem] font-bold uppercase tracking-wider text-emerald-600">Upgrade Services</p>
          <h2 className="text-xl font-extrabold text-slate-800 mt-1">Available Upgrades</h2>
          <p className="text-sm text-slate-500 mt-1">Add eligible services to this case without creating a new case.</p>
        </div>
        {purchasedPremium && (
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-emerald-700">
            {purchasedPremium.paymentStatus === "paid" ? "Paid" : purchasedPremium.status?.replace(/_/g, " ")}
          </span>
        )}
      </div>
      {loading ? (
        <p className="mt-4 text-sm font-semibold text-slate-500">Checking available upgrades...</p>
      ) : purchasedPremium ? (
        <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="font-bold text-emerald-900">Premium Processing (I-907)</p>
          <p className="text-sm text-emerald-700 mt-1">This upgrade is attached to your existing case.</p>
        </div>
      ) : premium ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-extrabold text-slate-900">Premium Processing (Form I-907)</p>
                <p className="text-sm text-slate-500">Processing Time: {premium.processingTime}</p>
              </div>
              <p className="text-2xl font-black text-slate-900">{moneyFromCents(premium.totalFeeCents)}</p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs text-slate-500">Government Fee</p>
                <p className="font-bold text-slate-800">{moneyFromCents(premium.governmentFeeCents)}</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs text-slate-500">Attorney Fee</p>
                <p className="font-bold text-slate-800">{moneyFromCents(premium.attorneyFeeCents)}</p>
              </div>
              <div className="rounded-lg bg-white p-3">
                <p className="text-xs text-slate-500">Related Form</p>
                <p className="font-bold text-slate-800">{premium.form}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(premium.eligibility?.checks || []).map((check) => (
                <div key={check.key} className="flex items-center gap-2 text-sm">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full ${check.passed ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                    <Ic.Check />
                  </span>
                  <span className={check.passed ? "text-slate-700" : "text-slate-400"}>{check.label}</span>
                </div>
              ))}
            </div>
            {!premium.eligibility?.available && (
              <div className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
                Premium Processing is not available for this petition.
              </div>
            )}
            {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
          </div>
          <button
            type="button"
            onClick={() => onPurchase(premium.key)}
            disabled={!premium.eligibility?.available || purchasing}
            className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-extrabold text-white shadow-sm hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {purchasing ? "Starting checkout..." : "Add Upgrade"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── Case Progress Tracker ──────────────────────────────────────────────────── */
function CaseProgressTracker({ currentStage, visaType, journeyProgress }) {
  const lifecycleMilestones = journeyProgress?.milestones || [];
  if (lifecycleMilestones.length) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
          <div>
            <h2 className="text-lg font-extrabold text-slate-800">Application Progress</h2>
            <p className="text-sm text-slate-500 mt-0.5">{visaType} · {journeyProgress.nextAction?.label || "Lifecycle complete"}</p>
          </div>
          <span className="text-xs font-bold px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
            {journeyProgress.percent || 0}% complete
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-7">
          {lifecycleMilestones.map((milestone, index) => {
            const active = milestone.key === journeyProgress.currentMilestone;
            return (
              <div key={milestone.key} className={`rounded-xl border p-3 ${milestone.completed ? "border-emerald-200 bg-emerald-50" : active ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
                <div className={`mb-2 flex h-7 w-7 items-center justify-center rounded-full text-xs font-black ${milestone.completed ? "bg-emerald-600 text-white" : active ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-500"}`}>
                  {milestone.completed ? <Ic.Check /> : index + 1}
                </div>
                <p className={`text-xs font-bold leading-tight ${milestone.completed ? "text-emerald-800" : active ? "text-blue-800" : "text-slate-500"}`}>{milestone.label}</p>
                <p className="mt-1 text-[0.62rem] font-semibold uppercase tracking-wide text-slate-400">{milestone.completed ? "Completed" : active ? "Current" : "Pending"}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div className="h-full rounded-full bg-linear-to-r from-emerald-400 to-teal-500 transition-all duration-1000" style={{ width: `${journeyProgress.percent || 0}%` }} />
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <h2 className="text-lg font-extrabold text-slate-800">Application Progress</h2>
          <p className="text-sm text-slate-500 mt-0.5">{visaType} · Stage {currentStage + 1} of {CASE_STAGES.length} — {CASE_STAGES[currentStage]?.label}</p>
        </div>
        <span className="text-xs font-bold px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
          {CASE_STAGES[currentStage]?.label}
        </span>
      </div>

      {/* Desktop / tablet tracker — horizontally scrollable so 8 stages fit cleanly */}
      <div className="hidden sm:block overflow-x-auto pb-1">
        <div className="relative flex items-start min-w-160">
          {/* Connecting lines */}
          <div className="absolute top-5 left-0 right-0 flex px-[4.16%]">
            {CASE_STAGES.slice(0, -1).map((_, i) => (
              <div key={i} className="flex-1 h-0.5"
                style={{ background: i < currentStage ? "#1D9E75" : i === currentStage ? "linear-gradient(to right,#1D9E75,#e2e8f0)" : "#e2e8f0" }} />
            ))}
          </div>

          {CASE_STAGES.map((s, i) => {
            const done   = i < currentStage;
            const active = i === currentStage;
            return (
              <div key={s.id} className="flex-1 flex flex-col items-center gap-2 relative z-10">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-all
                  ${done   ? "bg-emerald-500 border-emerald-500 text-white shadow-md shadow-emerald-200"
                  : active ? "bg-white border-emerald-500 text-emerald-600 shadow-lg shadow-emerald-100 ring-4 ring-emerald-100"
                  : "bg-white border-slate-200 text-slate-400"}`}>
                  {done ? <Ic.Check /> : <s.icon />}
                </div>
                <div className="text-center px-0.5">
                  <p className={`text-[0.65rem] font-bold leading-tight ${active ? "text-emerald-700" : done ? "text-slate-600" : "text-slate-400"}`}>
                    {s.label}
                  </p>
                </div>
                {active && (
                  <span className="text-[0.58rem] font-extrabold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full border border-emerald-200 animate-pulse whitespace-nowrap">
                    Current
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile tracker (vertical) */}
      <div className="sm:hidden space-y-0">
        {CASE_STAGES.map((s, i) => {
          const done   = i < currentStage;
          const active = i === currentStage;
          return (
            <div key={s.id} className="flex gap-4">
              {/* Line + dot column */}
              <div className="flex flex-col items-center">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center border-2 shrink-0
                  ${done    ? "bg-emerald-500 border-emerald-500 text-white"
                  : active  ? "bg-white border-emerald-500 text-emerald-600 ring-4 ring-emerald-100"
                  : "bg-white border-slate-200 text-slate-400"}`}>
                  {done ? <Ic.Check /> : <s.icon />}
                </div>
                {i < CASE_STAGES.length - 1 && (
                  <div className="w-0.5 h-8 mt-1"
                    style={{ background: i < currentStage ? "#1D9E75" : "#e2e8f0" }} />
                )}
              </div>
              {/* Text */}
              <div className="pb-6 pt-1.5">
                <p className={`text-sm font-bold ${active ? "text-emerald-700" : done ? "text-slate-600" : "text-slate-400"}`}>
                  {s.label}
                  {active && <span className="ml-2 text-[0.6rem] font-extrabold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200 align-middle">Current</span>}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{s.sub}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div className="mt-5 pt-5 border-t border-slate-100">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-semibold text-slate-500">Overall Progress</span>
          <span className="text-xs font-extrabold text-emerald-700">{Math.round((currentStage / (CASE_STAGES.length - 1)) * 100)}%</span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-linear-to-r from-emerald-400 to-teal-500 rounded-full transition-all duration-1000"
            style={{ width: `${(currentStage / (CASE_STAGES.length - 1)) * 100}%` }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[0.6rem] text-slate-400">Intake</span>
          <span className="text-[0.6rem] text-slate-400">Approved</span>
        </div>
      </div>
    </div>
  );
}

/* ── Key Dates ──────────────────────────────────────────────────────────────── */
function KeyDates({ startedDate }) {
  const dates = [
    {
      label: "Document Submission",
      date:  new Date(Date.now() + 7 * 86400000).toISOString(),
      note:  "Upload all required documents",
      urgency: "high",
    },
    {
      label: "DS-160 Filing Deadline",
      date:  new Date(Date.now() + 30 * 86400000).toISOString(),
      note:  "Online visa application form",
      urgency: "medium",
    },
    {
      label: "Visa Fee Payment",
      date:  new Date(Date.now() + 45 * 86400000).toISOString(),
      note:  "MRV fee must be paid before interview",
      urgency: "low",
    },
    {
      label: "Estimated Case Completion",
      date:  new Date(Date.now() + 90 * 86400000).toISOString(),
      note:  "Subject to USCIS processing times",
      urgency: "future",
    },
  ];

  

  const urgencyStyles = {
    high:   { bar: "bg-red-400",    badge: "bg-red-50 text-red-600 border-red-200",    dot: "bg-red-400"    },
    medium: { bar: "bg-amber-400",  badge: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-400" },
    low:    { bar: "bg-blue-400",   badge: "bg-blue-50 text-blue-600 border-blue-200",  dot: "bg-blue-400"   },
    future: { bar: "bg-slate-300",  badge: "bg-slate-50 text-slate-500 border-slate-200", dot: "bg-slate-300" },
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
          <Ic.Calendar />
        </div>
        <div>
          <h3 className="font-extrabold text-slate-800 text-sm">Key Dates & Deadlines</h3>
          <p className="text-xs text-slate-400">Case started {fmtDate(startedDate)}</p>
        </div>
      </div>

      <ul className="divide-y divide-slate-100">
        {dates.map((d, i) => {
          const days = daysUntil(d.date);
          const s    = urgencyStyles[d.urgency];
          return (
            <li key={i} className="px-5 py-3.5 flex items-start gap-3">
              <div className={`w-1 self-stretch rounded-full shrink-0 ${s.bar}`} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-700">{d.label}</p>
                  {days !== null && days >= 0 && (
                    <span className={`text-[0.62rem] font-bold px-2 py-0.5 rounded-full border ${s.badge}`}>
                      {days === 0 ? "Today" : days === 1 ? "Tomorrow" : `${days}d`}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{d.note}</p>
                <p className="text-xs font-semibold text-slate-600 mt-1">{fmtDate(d.date)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
function PaymentSummaryCard({ plan }) {
    if (!plan) return null;

    const status = plan.paymentStatus || "not_started";
    // plan.amount is stored in cents (see case.controller.js's plan.amount
    // normalization and payment.service.js, which copies it straight into
    // Payment.totalAmount/baseAmount - all cents) - moneyFromCents divides
    // by 100 before formatting, same helper this file already uses for
    // paymentSummary.amountPaid/remainingAmount below.
    const formattedAmount = moneyFromCents(plan.amount);

    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <Ic.Passport />
          </div>
          <div>
            <h3 className="font-extrabold text-slate-800 text-sm">Payment Summary</h3>
            <p className="text-xs text-slate-400">
              {PLAN_LABELS[plan.tier] || "No plan selected"}
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-400">Total Fee</span>
            <span className="text-sm font-extrabold text-slate-800">{formattedAmount}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-400">Payment Status</span>
            <span
              className={`text-[0.68rem] font-bold px-2.5 py-1 rounded-full border ${
                PAYMENT_STATUS_COLORS[status] || PAYMENT_STATUS_COLORS.not_started
              }`}
            >
              {PAYMENT_STATUS_LABELS[status] || "Not Started"}
            </span>
          </div>

          <Link
            to="/dashboard/payments"
            className="block text-center mt-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 font-extrabold text-sm py-2.5 no-underline hover:bg-emerald-100 transition"
          >
            View Payment Details
          </Link>
        </div>
      </div>
    );
  }

/* ── Activity Feed ──────────────────────────────────────────────────────────── */
function ActivityFeed({ caseData, profileSavedAt }) {
  let items = [
    { time: "2 hours ago",   text: "Your profile was reviewed by the case team",       type: "info"    },
    { time: "Yesterday",     text: "Reminder: Document deadline is in 7 days",         type: "warn"    },
    { time: "2 days ago",    text: "Profile setup completed successfully",              type: "success" },
    { time: "3 days ago",    text: "New case opened — F-1 Student Visa application",   type: "info"    },
    { time: "3 days ago",    text: "Welcome to the BAIS Immigration Client Portal",    type: "success" },
  ];

  const timeAgo = (iso) => {
    if (!iso) return "Just now";
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff) || diff < 60000) return "Just now";
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
    return fmtDate(iso);
  };

  const timelineItems = [...(caseData?.timeline || [])]
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
    .slice(0, 5)
    .map((event) => ({
      time: timeAgo(event.createdAt),
      text: event.description || event.title,
      type: event.type === "questionnaire" || event.type === "assignment" ? "success" : event.type === "deadline" ? "warn" : "info",
    }));

  items = timelineItems.length ? timelineItems : [
    caseData ? {
      time: timeAgo(caseData.updatedAt || caseData.createdAt),
      text: `Case status is ${String(caseData.status || "active").replace(/_/g, " ")} at ${CASE_STAGES[normalizeCaseStage(caseData)]?.label || "Intake"}.`,
      type: caseData.status === "pending_assignment" ? "warn" : "info",
    } : null,
    profileSavedAt ? { time: timeAgo(profileSavedAt), text: "Your profile information was saved.", type: "success" } : null,
    { time: "Just now", text: "Welcome to the BAIS Immigration Client Portal.", type: "success" },
  ].filter(Boolean);

  const typeStyles = {
    success: { dot: "bg-emerald-400", bg: "bg-emerald-50",  text: "text-emerald-700" },
    info:    { dot: "bg-blue-400",    bg: "bg-blue-50",     text: "text-blue-700"    },
    warn:    { dot: "bg-amber-400",   bg: "bg-amber-50",    text: "text-amber-700"   },
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center">
          <Ic.Clock />
        </div>
        <h3 className="font-extrabold text-slate-800 text-sm">Recent Activity</h3>
      </div>
      <ul className="divide-y divide-slate-100">
        {items.map((item, i) => {
          const s = typeStyles[item.type] || typeStyles.info;
          return (
            <li key={i} className={`flex items-start gap-3 px-5 py-3.5 ${i === 0 ? s.bg + "/40" : ""}`}>
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${s.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700 leading-snug">{item.text}</p>
                <p className="text-xs text-slate-400 mt-0.5">{item.time}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ── Case Info Card ─────────────────────────────────────────────────────────── */
function CaseInfo({ caseData, profileData }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
          <Ic.Shield />
        </div>
        <h3 className="font-extrabold text-slate-800 text-sm">Case Information</h3>
      </div>

      <div className="px-5 py-4 space-y-3">
        {[
          { label: "Case ID",            value: caseData.caseId                            },
          { label: "Visa Category",      value: caseData.visaCategory || "Not Selected"    },
          { label: "Visa Type",          value: resolveDisplayVisa(caseData)               },
          { label: "Current Stage",      value: CASE_STAGES[caseData.currentStage]?.label || "Intake" },
          { label: "Processing Type",    value: caseData.priority                          },
          { label: "USCIS Receipt No.",  value: caseData.uscisNumber                       },
          { label: "Case Opened",        value: fmtDate(caseData.createdAt || caseData.startedDate) },
          { label: "Citizenship",        value: profileData.countryOfCitizenship || "Not provided" },
          { label: "Nationality",        value: profileData.nationality   || "Not provided" },
        ].map(({ label, value }) => (
          <div key={label} className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold text-slate-400 shrink-0">{label}</span>
            <span className="text-xs font-bold text-slate-700 text-right truncate max-w-40">{value}</span>
          </div>
        ))}
      </div>

      {/* Assigned agent */}
      <div className="px-5 py-4 border-t border-slate-100 bg-slate-50">
        <p className="text-[0.68rem] font-extrabold uppercase tracking-wider text-slate-400 mb-3">Assigned Agent</p>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-linear-to-br from-[#1D9E75] to-teal-600
            flex items-center justify-center text-white font-extrabold text-sm shrink-0">
            PS
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800">{caseData.assignedAgent}</p>
            <p className="text-xs text-slate-500">Immigration Consultant</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <a href={`mailto:${caseData.agentEmail}`}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold
              bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-100 transition no-underline">
            <Ic.Mail /> Email
          </a>
          <a href="tel:+15107708700"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold
              bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-700 hover:bg-emerald-100 transition no-underline">
            <Ic.Phone /> Call
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Announcements ──────────────────────────────────────────────────────────── */
function Announcements() {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
          <Ic.Info />
        </div>
        <h3 className="font-extrabold text-slate-800 text-sm">Notices & Announcements</h3>
      </div>
      <div className="divide-y divide-slate-100">
        {ANNOUNCEMENTS.map((a) => (
          <div key={a.id} className={`px-5 py-4 ${a.urgent ? "bg-red-50/40" : ""}`}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <p className="text-sm font-bold text-slate-800 leading-snug">{a.title}</p>
              <span className={`text-[0.62rem] font-bold px-2 py-0.5 rounded-full border shrink-0 ${a.tagColor} border-current/20`}>
                {a.tag}
              </span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{a.body}</p>
            <p className="text-[0.65rem] text-slate-400 mt-2 font-medium">{a.date}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Quick Actions ──────────────────────────────────────────────────────────── */
function QuickActions({ profileComplete }) {
  const actions = [
    { label: "Complete Profile", to: "/dashboard/profile",   icon: Ic.User,    color: "from-emerald-500 to-teal-600",    shadow: "shadow-emerald-200", done: profileComplete },
    { label: "Upload Documents", to: "/dashboard/documents", icon: Ic.Upload,  color: "from-blue-500 to-blue-600",       shadow: "shadow-blue-200",    done: false },
    { label: "View Case Status", to: null, scrollTo: "case-progress", icon: Ic.Shield, color: "from-violet-500 to-violet-600", shadow: "shadow-violet-200", done: false },
    { label: "Contact Agent",    to: "mailto:info@bayareaimmigrationservices.com", icon: Ic.Agent, color: "from-slate-600 to-slate-700", shadow: "shadow-slate-200", done: false },
  ];

  const btnClass = (a) => `relative flex flex-col items-center gap-2 py-4 px-3 rounded-xl
    bg-linear-to-br ${a.color} text-white text-center no-underline
    shadow-lg ${a.shadow} hover:shadow-xl hover:-translate-y-0.5 transition-all active:scale-95 cursor-pointer`;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {actions.map((a) => {
        const inner = (
          <>
            {a.done && (
              <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-white/30 flex items-center justify-center text-white">
                <Ic.Check />
              </span>
            )}
            <span className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <a.icon />
            </span>
            <span className="text-xs font-bold leading-tight">{a.label}</span>
          </>
        );

        if (a.scrollTo) {
          return (
            <button key={a.label} onClick={() => {
              document.getElementById(a.scrollTo)?.scrollIntoView({ behavior: "smooth" });
            }} className={btnClass(a)}>
              {inner}
            </button>
          );
        }
        return (
          <Link key={a.label} to={a.to} className={btnClass(a)}>
            {inner}
          </Link>
        );
      })}
    </div>
  );
}

/* ─── Expert Letter Status Card ──────────────────────────────────────────────── */
const EL_STATUS_LABELS = {
  not_started:              "Not Started",
  professor_assigned:       "Professor Assigned",
  draft_in_progress:        "Draft In Progress",
  professor_review_pending: "Under Professor Review",
  revision_needed:          "Revision Needed",
  signed_letter_received:   "Letter Received",
};
const EL_STATUS_COLORS = {
  not_started:              "bg-slate-100 text-slate-500 border-slate-200",
  professor_assigned:       "bg-blue-100 text-blue-700 border-blue-200",
  draft_in_progress:        "bg-amber-100 text-amber-700 border-amber-200",
  professor_review_pending: "bg-violet-100 text-violet-700 border-violet-200",
  revision_needed:          "bg-red-100 text-red-600 border-red-200",
  signed_letter_received:   "bg-emerald-100 text-emerald-700 border-emerald-200",
};

function ExpertLettersCard({ letters }) {
  if (!letters || letters.length === 0) return null;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-violet-50 text-violet-600 flex items-center justify-center">
          <Ic.Star />
        </div>
        <div>
          <h3 className="font-extrabold text-slate-800 text-sm">Expert Letters</h3>
          <p className="text-xs text-slate-400">{letters.filter(l => l.status === "signed_letter_received").length}/{letters.length} received</p>
        </div>
      </div>
      <ul className="divide-y divide-slate-100">
        {letters.map((l, i) => (
          <li key={i} className="px-5 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{l.professorName || `Expert Letter ${i + 1}`}</p>
              {l.institution && <p className="text-xs text-slate-400">{l.institution}</p>}
            </div>
            <span className={`text-[0.68rem] font-bold px-2 py-0.5 rounded-full border shrink-0 ${EL_STATUS_COLORS[l.status] || EL_STATUS_COLORS.not_started}`}>
              {EL_STATUS_LABELS[l.status] || l.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─── Attorney Review Card ───────────────────────────────────────────────────── */
const AR_STATUS_LABELS = {
  not_started:    "Not Started",
  pending_review: "Under Review",
  needs_revision: "Revision Needed",
  approved:       "Approved",
  declined:       "Declined",
};
const AR_STATUS_COLORS = {
  not_started:    "bg-slate-100 text-slate-500 border-slate-200",
  pending_review: "bg-amber-100 text-amber-700 border-amber-200",
  needs_revision: "bg-red-100 text-red-600 border-red-200",
  approved:       "bg-emerald-100 text-emerald-700 border-emerald-200",
  declined:       "bg-red-100 text-red-700 border-red-200",
};

function AttorneyReviewCard({ review }) {
  if (!review?.required) return null;
  const status = review.status || "not_started";
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
          <Ic.Shield />
        </div>
        <div>
          <h3 className="font-extrabold text-slate-800 text-sm">Attorney Review</h3>
          <p className="text-xs text-slate-400">{review.attorneyName || "Attorney assigned by BAIS"}</p>
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-500">Review Status</span>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${AR_STATUS_COLORS[status]}`}>
            {AR_STATUS_LABELS[status]}
          </span>
        </div>
        {review.reviewStartedAt && (
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Review Started</span>
            <span className="text-xs font-bold text-slate-700">{fmtDate(review.reviewStartedAt)}</span>
          </div>
        )}
        {review.reviewedAt && (
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-500">Completed</span>
            <span className="text-xs font-bold text-slate-700">{fmtDate(review.reviewedAt)}</span>
          </div>
        )}
        {review.attorneyComments && (
          <div className="mt-2 bg-slate-50 rounded-lg px-3 py-2.5 text-xs text-slate-600 leading-relaxed">
            "{review.attorneyComments}"
          </div>
        )}
      </div>
    </div>
  );
}

/* ── My Tasks (invited-employee view) — open information requests from the case manager/employer ── */
function MyTasksCard({ caseData }) {
  const openTasks = (caseData?.informationRequests || []).filter((item) => item.target === "employee" && item.status === "open");
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
          <Ic.Alert />
        </div>
        <div>
          <h3 className="font-extrabold text-slate-800 text-sm">My Tasks</h3>
          <p className="text-xs text-slate-400">{openTasks.length} open request{openTasks.length === 1 ? "" : "s"}</p>
        </div>
      </div>
      {openTasks.length ? (
        <ul className="divide-y divide-slate-100">
          {openTasks.map((item) => (
            <li key={item._id} className="px-5 py-3.5">
              <p className="text-sm font-semibold text-slate-800">{item.title}</p>
              {item.description && <p className="text-xs text-slate-500 mt-0.5">{item.description}</p>}
              {item.dueDate && <p className="text-xs text-amber-600 font-semibold mt-1">Due {fmtDate(item.dueDate)}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-slate-400 text-center">Nothing outstanding — you're all caught up.</p>
      )}
    </div>
  );
}

/* ── Main Dashboard ─────────────────────────────────────────────────────────── */
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Brief one-time notice from a redirect elsewhere (e.g. BlockIfHasCase
  // sending a client who already has a case away from the eligibility
  // quiz) — cleared from history state immediately so a refresh/back-nav
  // doesn't keep re-showing it.
  const [notice, setNotice] = useState(location.state?.notice || "");
  useEffect(() => {
    if (!location.state?.notice) return;
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state, location.pathname, navigate]);
  const [profileData, setProfileData] = useState({});
  const [profileComplete, setProfileComplete] = useState(false);
  const [caseData, setCaseData] = useState(null);
  const [paymentSummary, setPaymentSummary] = useState(null);
  const [docsCount, setDocsCount] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [showVisaInfo, setShowVisaInfo] = useState(false);
  const [availableAddons, setAvailableAddons] = useState([]);
  const [purchasedAddons, setPurchasedAddons] = useState([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [purchasingAddon, setPurchasingAddon] = useState(false);
  const [addonError, setAddonError] = useState("");
  const [caseLoadError, setCaseLoadError] = useState("");

  useEffect(() => {
    document.title = "Dashboard | BAIS Immigration Portal";
  }, []);

  const isEmployee = isEmployeeAccount(user);

  const loadCase = useCallback(async () => {
    const currentCase = await casesApi.my();
    const normalizedCase = currentCase?.case || currentCase?.data?.case || currentCase;
    let workflow;
    if (normalizedCase?._id) {
      const response = await casesApi.workflow(normalizedCase._id).catch(() => null);
      workflow = response?.workflow || response?.data?.workflow || response?.data || response;
    }
    const nextCase = normalizedCase ? {
      ...normalizedCase,
      currentStage: normalizeCaseStage(normalizedCase),
      journeyProgress: workflow?.progress || normalizedCase.journeyProgress,
      timeline: workflow?.timeline || normalizedCase.timeline,
    } : null;
    setCaseData(nextCase);
    if (nextCase?._id) {
      setAddonsLoading(true);
      casesApi.addons(nextCase._id)
        .then((response) => {
          setAvailableAddons(response.addons || []);
          setPurchasedAddons(response.purchased || nextCase.addons || []);
          setAddonError("");
        })
        .catch((error) => {
          setAvailableAddons([]);
          setPurchasedAddons(nextCase.addons || []);
          setAddonError(error.message || "Unable to load upgrades.");
        })
        .finally(() => setAddonsLoading(false));
    }
    return nextCase;
  }, []);

  const handlePurchaseAddon = async (addonKey) => {
    if (!caseData?._id || purchasingAddon) return;
    setPurchasingAddon(true);
    setAddonError("");
    try {
      const response = await casesApi.purchaseAddon(caseData._id, addonKey);
      if (response.checkout?.url) {
        window.location.href = response.checkout.url;
        return;
      }
      await loadCase();
    } catch (error) {
      setAddonError(error.message || "Unable to start upgrade checkout.");
    } finally {
      setPurchasingAddon(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    profileApi.get()
      .then((p) => {
        if (cancelled) return;
        setProfileData(p);
        setProfileComplete(p.completed || false);
      })
      .catch(() => {});

    loadCase()
      .then(async (currentCase) => {
        if (cancelled) return;
        setCaseLoadError("");
        // No case at all → send to intake wizard to create one. Invited
        // employees never go through intake — their case is created by the
        // employer, so an employee with no case yet just sees an empty state.
        if (!currentCase?._id && !isEmployee) {
          navigate("/dashboard/intake", { replace: true });
          return;
        }
        // Case exists → check questionnaire status
        // Profile and Documents now surface assigned checklist work.
        // If not assigned yet, or already completed → stay on dashboard
      })
      .catch((error) => {
        if (cancelled) return;
        // Previously navigated to /dashboard/intake here on ANY failure —
        // meaning a transient 504/network error on GET /cases/my (an
        // existing client's case fetch just failing, not "no case exists")
        // sent an existing client into the create-a-new-case wizard. A
        // failed fetch is not evidence there's no case; show a retryable
        // error on the dashboard instead of guessing and navigating away.
        setCaseLoadError(error.message || "Unable to load your case right now.");
      });

    documentsApi.list()
      .then((docs) => setDocsCount(Array.isArray(docs) ? docs.length : 0))
      .catch(() => {});

    messagesApi.getUnreadCount()
      .then((r) => setUnreadMessages(r.unreadCount || 0))
      .catch(() => {});

    paymentsApi.summary()
      .then(setPaymentSummary)
      .catch(() => setPaymentSummary(null));

    return () => {
      cancelled = true;
    };
  }, [navigate, loadCase]);

  const savedAt = profileData?.updatedAt;

  // Profile completion score
  const profileFields = [
    profileData.firstName, profileData.lastName, profileData.dateOfBirth,
    profileData.gender, profileData.maritalStatus, profileData.email || user?.email,
    profileData.primaryPhone, profileData.address, profileData.city,
    profileData.country, profileData.nationality, profileData.nativeLanguage,
  ];
  const profilePct = profileComplete
    ? 100
    : Math.round((profileFields.filter(Boolean).length / profileFields.length) * 100);

  const displayName = profileData.firstName
    ? `${profileData.firstName}${profileData.lastName ? " " + profileData.lastName : ""}`
    : user?.displayName || user?.email?.split("@")[0] || "Client";

  const initials = displayName.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  // Same reusable-document resolution Documents.jsx uses, so this dashboard's
  // "required" counts never disagree with the Documents page.
  const { checklist } = useCaseDocumentChecklist(caseData, String(user?.role || "client").toLowerCase());
  const requiredDocs = buildCaseCategories(checklist).flatMap((c) => c.docs).filter((d) => d.required);
  const requiredDocsCount = requiredDocs.length;
  const documentsProgressPct = Math.min((docsCount / Math.max(requiredDocsCount, 1)) * 100, 100);

  const activeCaseData = caseData || {
    caseId:        "Pending",
    visaCategory:  "Not Selected",
    visaType:      "Not Assigned",
    currentStage:  0,
    assignedAgent: "BAIS Team",
    agentEmail:    "info@bayareaimmigrationservices.com",
    createdAt:     new Date().toISOString(),
    uscisNumber:   "Pending Assignment",
    priority:      "Standard Processing",
  };

  const daysActive = daysAgo(savedAt);

  return (
    <div className="min-h-screen bg-[#f1f5f9]">

      {notice && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-amber-800">{notice}</p>
          <button onClick={() => setNotice("")} aria-label="Dismiss" className="text-amber-600 hover:text-amber-800 shrink-0">
            <Ic.X />
          </button>
        </div>
      )}

      {caseLoadError && (
        <div className="bg-red-50 border-b border-red-200 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-red-800">{caseLoadError}</p>
          <button
            onClick={() => { setCaseLoadError(""); loadCase().catch((error) => setCaseLoadError(error.message || "Unable to load your case right now.")); }}
            className="text-sm font-bold text-red-700 hover:text-red-900 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Welcome Banner ── */}
      <div className="bg-linear-to-r from-[#1D9E75] via-teal-600 to-blue-700 text-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-white/25 border-2 border-white/40
                flex items-center justify-center text-lg font-extrabold shrink-0">
                {initials}
              </div>
              <div>
                <p className="text-white/70 text-xs font-semibold uppercase tracking-wider">Immigration Client Portal</p>
                <h1 className="text-xl font-extrabold mt-0.5">Welcome back, {displayName.split(" ")[0]}!</h1>
                <p className="text-white/80 text-sm mt-0.5">
                  {activeCaseData.visaCategory && activeCaseData.visaCategory !== "Not Selected"
                    ? <>{activeCaseData.visaCategory} · </>
                    : null}
                  <span className="font-semibold">{resolveDisplayVisa(activeCaseData)}</span>
                  <button onClick={() => setShowVisaInfo(true)} title="Visa details"
                    className="ml-2 inline-flex items-center justify-center w-6 h-6 rounded-full bg-white/20 text-white/90 border border-white/25">
                    <Ic.Info />
                  </button>
                  {" "}· Case <span className="font-bold">{activeCaseData.caseId}</span>
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {showVisaInfo && (
                <InfoPopup open={showVisaInfo} onClose={() => setShowVisaInfo(false)}
                  title={activeCaseData.visaCategory || "Visa Types"}
                  description={(() => {
                    const cat = VISA_CATEGORIES.find(c => c.id === activeCaseData.visaCategory);
                    return cat ? cat.desc : "Select a visa subtype or start an eligibility quiz.";
                  })()}
                  items={(VISA_DETAILS[activeCaseData.visaCategory] || VISA_TYPES[activeCaseData.visaCategory] || [])}
                  onSelect={(visaType) => { setShowVisaInfo(false); navigate('/dashboard/intake', { state: { visaType } }); }}
                />
              )}
              {!profileComplete && (
                <div className="bg-amber-400/30 border border-amber-300/50 rounded-xl px-4 py-2.5 flex items-center gap-2">
                  <Ic.Alert />
                  <span className="text-sm font-bold">Complete your profile to proceed</span>
                </div>
              )}
              <Link to="/dashboard/profile"
                className="flex items-center gap-2 bg-white/20 hover:bg-white/30 border border-white/30
                  rounded-xl px-4 py-2.5 text-sm font-bold transition no-underline text-white">
                <Ic.User /> My Profile
              </Link>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 space-y-6">

        {/* ── Quick Actions ── */}
        <QuickActions profileComplete={profileComplete} />

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {/* Row 1: Profile + Documents + Case Stage */}
          <KpiCard
            label="Profile"
            value={`${profilePct}%`}
            sub={profileComplete ? "Complete" : "Incomplete"}
            circPct={profilePct}
            circColor={profilePct === 100 ? "#1D9E75" : profilePct > 50 ? "#f59e0b" : "#ef4444"}
          />
          <KpiCard
            icon={<Ic.Docs />}
            label="Documents"
            value={`${docsCount}`}
            sub={`Uploaded · ${requiredDocsCount} required`}
            color="bg-blue-50 text-blue-600"
            progress={documentsProgressPct}
            barColor="bg-blue-500"
          />
          <KpiCard
            icon={<Ic.Shield />}
            label="Case Progress"
            value={`${activeCaseData.journeyProgress?.percent ?? Math.round((activeCaseData.currentStage / (CASE_STAGES.length - 1)) * 100)}%`}
            sub={activeCaseData.journeyProgress?.nextAction?.label || CASE_STAGES[activeCaseData.currentStage]?.label}
            color="bg-violet-50 text-violet-600"
            progress={activeCaseData.journeyProgress?.percent ?? ((activeCaseData.currentStage) / (CASE_STAGES.length - 1)) * 100}
            barColor="bg-violet-500"
          />
          {!isEmployee && (
            <>
              <KpiCard
                label="Payment Paid"
                value={paymentSummary ? moneyFromCents(paymentSummary.amountPaid) : "$0.00"}
                sub="Amount received"
              />
              <KpiCard
                label="Remaining Balance"
                value={paymentSummary ? moneyFromCents(paymentSummary.remainingAmount) : "$0.00"}
                sub="Amount pending"
              />
            </>
          )}
        </div>

        {/* ── Visa Info Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard compact
            icon={<Ic.Globe />}
            label="Visa Category"
            value={activeCaseData.visaCategory || "Not Selected"}
            sub="Immigration pathway"
            color={activeCaseData.visaCategory && activeCaseData.visaCategory !== "Not Selected"
              ? "bg-emerald-50 text-emerald-600"
              : "bg-slate-100 text-slate-400"}
          />
          <KpiCard compact
            icon={<Ic.Passport />}
            label="Visa Type"
            value={activeCaseData.visaType !== "Not Assigned" ? resolveDisplayVisa(activeCaseData) : "—"}
            sub="Selected visa classification"
            color={activeCaseData.visaType !== "Not Assigned"
              ? "bg-blue-50 text-blue-600"
              : "bg-slate-100 text-slate-400"}
          />
          <KpiCard compact
            icon={<Ic.Agent />}
            label="Case Manager"
            value={activeCaseData.assignedAgent || "BAIS Team"}
            sub={activeCaseData.agentEmail || "info@bayareaimmigrationservices.com"}
            color="bg-teal-50 text-teal-600"
          />
        </div>

        {/* ── Plan + Payment + Messages row ── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {!isEmployee && (
            <>
              <KpiCard compact
                icon={<Ic.Shield />}
                label="Service Plan"
                value={PLAN_LABELS[activeCaseData.plan?.tier] || "Not Selected"}
                sub={activeCaseData.plan?.tier ? "Active plan" : "Select a plan to activate"}
                color={activeCaseData.plan?.tier ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400"}
              />
              <KpiCard compact
                icon={<Ic.Clock />}
                label="Payment Status"
                value={PAYMENT_STATUS_LABELS[activeCaseData.plan?.paymentStatus] || "Not Started"}
                sub={activeCaseData.plan?.paidAt ? `Paid ${fmtDate(activeCaseData.plan.paidAt)}` : "Contact team to pay"}
                color={PAYMENT_STATUS_COLORS[activeCaseData.plan?.paymentStatus]?.split(" ")[0] || "bg-slate-100"}
              />
            </>
          )}
          <Link to="/dashboard/messages" className="no-underline">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex items-center gap-4 hover:shadow-md transition-shadow relative">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-violet-50 text-violet-600 relative">
                <Ic.Mail />
                {unreadMessages > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[0.6rem] font-extrabold rounded-full flex items-center justify-center">
                    {unreadMessages}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[0.72rem] font-bold uppercase tracking-wider text-slate-400">Messages</p>
                <p className="text-2xl font-extrabold text-slate-800 leading-tight mt-0.5">{unreadMessages || "0"}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {unreadMessages > 0 ? `${unreadMessages} unread message${unreadMessages > 1 ? "s" : ""}` : "No new messages"}
                </p>
              </div>
            </div>
          </Link>
        </div>

        {/* ── Case Progress Tracker ── */}
        {!isEmployee && (
          <UpgradeServicesCard
            addons={availableAddons}
            purchased={purchasedAddons}
            loading={addonsLoading}
            purchasing={purchasingAddon}
            error={addonError}
            onPurchase={handlePurchaseAddon}
          />
        )}

        {isEmployee && <MyTasksCard caseData={caseData} />}

        <div id="case-progress">
          <CaseProgressTracker currentStage={activeCaseData.currentStage} visaType={activeCaseData.visaType} journeyProgress={activeCaseData.journeyProgress} />
        </div>

        {/* The checklist itself lives only on the Documents page now — see
            Pages/Dashboard/Documents.jsx. Key dates is a genuine dashboard
            widget (not checklist content), so it stays. */}
        <KeyDates startedDate={activeCaseData.createdAt || activeCaseData.startedDate} />

        {/* ── Expert Letters + Attorney Review ── */}
        {(activeCaseData.expertLetters?.length > 0 || activeCaseData.attorneyReview?.required) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ExpertLettersCard letters={activeCaseData.expertLetters} />
            <AttorneyReviewCard review={activeCaseData.attorneyReview} />
          </div>
        )}

        {/* ── Activity + Case Info ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <ActivityFeed caseData={caseData} profileSavedAt={savedAt} />
          <CaseInfo caseData={activeCaseData} profileData={profileData} />
          {!isEmployee && <PaymentSummaryCard plan={activeCaseData?.plan} />}
        </div>

        {/* ── Announcements ── */}
        <Announcements />

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 pb-4">
          © 2025 BAIS · Bay Area Immigration Services (BAIS) ·{" "}
          <a href="mailto:info@bayareaimmigrationservices.com" className="text-emerald-600 hover:underline">info@bayareaimmigrationservices.com</a>
        </p>
      </div>
    </div>
  );
}
