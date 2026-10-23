import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import useCaseDataChanged from "../../hooks/useCaseDataChanged";
import { resolveDisplayVisa } from "../../utils/visaDisplay";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isEmployeeAccount } from "../../utils/auth";
import { api, API_BASE_URL, casesApi, documentsApi, employeeProfileApi, messagesApi, profileApi, questionnairesApi } from "../../services/api";
import { useMyCase, useMyProfile } from "../../hooks/useMyCaseProfile";
import { PLAN_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_COLORS } from "../../config/planConfig";
import { CASE_STATUS_STEPS, resolveCaseStepIndex } from "../../utils/caseStatusLabel";

/* ── Helpers ────────────────────────────────────────────────────────────────── */
const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "—";

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

/* ── Case stage labels — internal 8-stage CRM workflow, used only for the
   plain "Current Stage" value on the Case Information card below (the
   client-facing progress view is CaseStatusStepper's 5-step summary). ────── */
const CASE_STAGES = [
  { id: 0, label: "Intake" },
  { id: 1, label: "Strategy" },
  { id: 2, label: "Evidence" },
  { id: 3, label: "Expert Letters" },
  { id: 4, label: "Attorney Review" },
  { id: 5, label: "Filing" },
  { id: 6, label: "USCIS Pending" },
  { id: 7, label: "Approved" },
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

/* ── Circular Progress ──────────────────────────────────────────────────────── */
function moneyFromCents(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(value || 0) / 100);
}

/* ── Loading skeletons (P1 Fix 9) ─────────────────────────────────────────────
   animate-pulse placeholders shown only during the initial case fetch —
   replaces what used to be a blank/"Pending"-valued render for that window. */
function CaseProgressSkeleton() {
  return (
    <div className="bg-card rounded-lg border border-card-border p-6 animate-pulse" aria-hidden="true">
      <div className="h-4 w-40 bg-secondary rounded mb-2" />
      <div className="h-3 w-56 bg-muted rounded mb-6" />
      <div className="h-2 w-full bg-muted rounded-full mb-6" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex-1 min-w-20">
            <div className="w-9 h-9 rounded-full bg-muted mb-2" />
            <div className="h-2.5 w-full bg-muted rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Payment Summary ──────────────────────────────────────────────────────── */
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
      <div className="bg-card rounded-lg border border-card-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Ic.Passport />
          </div>
          <div>
            <h3 className="font-bold text-foreground text-sm">Payment Summary</h3>
            <p className="text-xs text-muted-foreground">
              {PLAN_LABELS[plan.tier] || "No plan selected"}
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted-foreground">Total Fee</span>
            <span className="text-sm font-bold text-foreground">{formattedAmount}</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted-foreground">Payment Status</span>
            <span
              className={`text-[0.68rem] font-bold px-2.5 py-1 rounded-full border ${
                PAYMENT_STATUS_COLORS[status] || PAYMENT_STATUS_COLORS.not_started
              }`}
            >
              {PAYMENT_STATUS_LABELS[status] || "Not Started"}
            </span>
          </div>

        </div>
      </div>
    );
  }

function agentInitials(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "?";
  return trimmed.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/* ── Case Snapshot: the case at a glance ── */
function CaseInfo({ caseData, profileData }) {
  const manager = caseData.assignedCaseManager;
  const managerName = (typeof manager === "object" && (manager?.displayName || manager?.name)) || "";
  const facts = [
    { label: "Case ID", value: caseData.caseId, mono: true },
    { label: "Stage", value: CASE_STAGES[caseData.currentStage]?.label || "Intake" },
    { label: "Processing", value: caseData.priority },
    { label: "Opened", value: fmtDate(caseData.createdAt || caseData.startedDate) },
    { label: "Citizenship", value: profileData.countryOfCitizenship || "Not provided" },
    { label: "Nationality", value: profileData.nationality || "Not provided" },
  ];
  return (
    <div id="case-info" className="overflow-hidden rounded-lg border border-card-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Your case</p>
          <h3 className="mt-1 truncate text-base font-semibold leading-tight text-foreground">{resolveDisplayVisa(caseData)}</h3>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{caseData.visaCategory || "Category not selected"}</p>
        </div>
        {caseData.uscisNumber && (
          <span className="shrink-0 rounded border border-border bg-secondary/50 px-2 py-1 font-mono text-[0.65rem] font-medium text-foreground">{caseData.uscisNumber}</span>
        )}
      </div>

      <dl className="grid grid-cols-2 divide-x divide-border">
        {facts.map(({ label, value, mono }, index) => (
          <div key={label} className={`min-w-0 px-5 py-3 ${index >= 2 ? "border-t border-border" : ""}`}>
            <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className={`mt-0.5 truncate text-sm font-semibold text-foreground ${mono ? "font-mono" : ""}`} title={String(value ?? "")}>{value || "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-3 border-t border-border bg-secondary/40 px-5 py-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{managerName ? agentInitials(managerName) : "—"}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{managerName || "To be assigned"}</p>
          <p className="text-xs text-muted-foreground">{managerName ? "Your case manager" : "A case manager will be assigned to you soon"}</p>
        </div>
        <Link to="/dashboard/messages" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground no-underline transition hover:text-primary" title="Message" aria-label="Message your case manager"><Ic.Mail /></Link>
        <a href="tel:+15107708700" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground no-underline transition hover:text-primary" title="Call" aria-label="Call your case manager"><Ic.Phone /></a>
      </div>
    </div>
  );
}

/* ── Quick Actions ─────────────────────────────────────────────────────────── */
function QuickActions({ profileComplete }) {
  const actions = [
    { label: "Upload Documents", to: "/dashboard/documents", icon: Ic.Upload },
    { label: "View Case Details", scrollTo: "case-info", icon: Ic.Shield },
    { label: "Message Your Team", to: "/dashboard/messages", icon: Ic.Agent },
    { label: "Latest USCIS Forms", to: "/dashboard/forms", icon: Ic.Docs },
    { label: "Complete Profile", to: "/dashboard/profile", icon: Ic.User, done: profileComplete },
  ];
  const rowClass = "group flex w-full items-center gap-3 px-5 py-3 text-left text-sm font-medium text-foreground no-underline transition-colors hover:bg-secondary/60 cursor-pointer";
  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card">
      <div className="border-b border-border px-5 py-3.5"><h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Quick actions</h3></div>
      <div className="divide-y divide-border">
        {actions.map((a) => {
          const inner = (
            <>
              <span className="text-primary"><a.icon /></span>
              <span className="flex-1">{a.label}</span>
              {a.done ? <span className="text-primary"><Ic.Check /></span> : <span className="text-muted-foreground transition-transform group-hover:translate-x-0.5"><Ic.Arrow /></span>}
            </>
          );
          return a.scrollTo ? (
            <button key={a.label} type="button" onClick={() => document.getElementById(a.scrollTo)?.scrollIntoView({ behavior: "smooth", block: "center" })} className={rowClass}>{inner}</button>
          ) : (
            <Link key={a.label} to={a.to} className={rowClass}>{inner}</Link>
          );
        })}
      </div>
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
  not_started:              "bg-secondary text-muted-foreground border-border",
  professor_assigned:       "bg-secondary text-muted-foreground border-border",
  draft_in_progress:        "bg-primary/10 text-primary border-primary/20",
  professor_review_pending: "bg-primary/10 text-primary border-primary/20",
  revision_needed:          "bg-destructive/10 text-destructive border-destructive/20",
  signed_letter_received:   "bg-primary/10 text-primary border-primary/20",
};

function ExpertLettersCard({ letters }) {
  if (!letters || letters.length === 0) return null;
  return (
    <div className="bg-card rounded-lg border border-card-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Ic.Star />
        </div>
        <div>
          <h3 className="font-bold text-foreground text-sm">Expert Letters</h3>
          <p className="text-xs text-muted-foreground">{letters.filter(l => l.status === "signed_letter_received").length}/{letters.length} received</p>
        </div>
      </div>
      <ul className="divide-y divide-border">
        {letters.map((l, i) => (
          <li key={i} className="px-5 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{l.professorName || `Expert Letter ${i + 1}`}</p>
              {l.institution && <p className="text-xs text-muted-foreground">{l.institution}</p>}
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
  not_started:    "bg-secondary text-muted-foreground border-border",
  pending_review: "bg-primary/10 text-primary border-primary/20",
  needs_revision: "bg-destructive/10 text-destructive border-destructive/20",
  approved:       "bg-primary/10 text-primary border-primary/20",
  declined:       "bg-destructive/10 text-destructive border-destructive/20",
};

function AttorneyReviewCard({ review }) {
  if (!review?.required) return null;
  const status = review.status || "not_started";
  return (
    <div className="bg-card rounded-lg border border-card-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Ic.Shield />
        </div>
        <div>
          <h3 className="font-bold text-foreground text-sm">Attorney Review</h3>
          <p className="text-xs text-muted-foreground">{review.attorneyName || "Attorney assigned by Immiglance"}</p>
        </div>
      </div>
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground">Review Status</span>
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${AR_STATUS_COLORS[status]}`}>
            {AR_STATUS_LABELS[status]}
          </span>
        </div>
        {review.reviewStartedAt && (
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Review Started</span>
            <span className="text-xs font-bold text-foreground">{fmtDate(review.reviewStartedAt)}</span>
          </div>
        )}
        {review.reviewedAt && (
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Completed</span>
            <span className="text-xs font-bold text-foreground">{fmtDate(review.reviewedAt)}</span>
          </div>
        )}
        {review.attorneyComments && (
          <div className="mt-2 bg-secondary rounded-lg px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
            "{review.attorneyComments}"
          </div>
        )}
      </div>
    </div>
  );
}

// BUG (fixed): this only ever filtered target === "employee" and was only
// ever rendered for isEmployee — a case manager's "Request Missing
// Information" panel (Admin/frontend/src/pages/CRMCaseDetail.jsx) lets a
// request be targeted at "employer" too, but nothing on the client side
// read/rendered those: an employer-targeted request sat open forever with
// no client-facing surface at all. Generalized to take the requesting
// role, and rendered for both isEmployee and the employer account below.
/* ── My Tasks — open information requests from the case manager ── */
function MyTasksCard({ caseData, role }) {
  const openTasks = (caseData?.informationRequests || []).filter((item) => item.target === role && item.status === "open");
  return (
    <div className="bg-card rounded-lg border border-card-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-secondary text-muted-foreground flex items-center justify-center">
          <Ic.Alert />
        </div>
        <div>
          <h3 className="font-bold text-foreground text-sm">My Tasks</h3>
          <p className="text-xs text-muted-foreground">{openTasks.length} open request{openTasks.length === 1 ? "" : "s"}</p>
        </div>
      </div>
      {openTasks.length ? (
        <ul className="divide-y divide-border">
          {openTasks.map((item) => (
            <li key={item._id} className="px-5 py-3.5">
              <p className="text-sm font-semibold text-foreground">{item.title}</p>
              {item.description && <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>}
              {item.dueDate && <p className="text-xs text-destructive font-semibold mt-1">Due {fmtDate(item.dueDate)}</p>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-muted-foreground text-center">Nothing outstanding — you're all caught up.</p>
      )}
    </div>
  );
}

/* ── Welcome banner: who the case belongs to, its details, and its progress through the pipeline ── */
function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

const initialsOf = (name) => String(name || "").trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "?";

// The steps shown are the stages of the case's own GoHighLevel pipeline when it has one (names and count come from there, so they follow any
// change made in GHL); otherwise the portal's standard five steps.
function CaseStatusStepper({ caseData, profileData, user, displayName, pipeline }) {
  const ghlStages = pipeline?.stages?.length ? pipeline.stages : null;
  const steps = ghlStages ? ghlStages.map((stage) => stage.name) : CASE_STATUS_STEPS;
  const found = ghlStages ? ghlStages.findIndex((stage) => stage.key === pipeline.currentKey) : -1;
  const currentIndex = ghlStages ? Math.max(0, found) : resolveCaseStepIndex(caseData);
  const statusLabel = steps[currentIndex] || "Evaluation In Progress";
  const email = profileData?.email || user?.email || "—";
  const phone = profileData?.primaryPhone || caseData?.clientPhone || "—";
  const details = [
    { label: "Email", value: email },
    { label: "Phone", value: phone },
    { label: "Visa category", value: caseData?.visaCategory && caseData.visaCategory !== "Not Selected" ? caseData.visaCategory : "Not selected" },
    { label: "Visa type", value: resolveDisplayVisa(caseData) || "Not assigned" },
    { label: "Case ID", value: caseData?.caseId, mono: true },
    { label: "Case opened", value: fmtDate(caseData?.createdAt || caseData?.startedDate) },
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card">
      <div className="flex flex-col gap-4 border-b border-border px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary text-base font-semibold text-primary-foreground">{initialsOf(displayName)}</span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{greeting()}</p>
            <h1 className="truncate text-xl font-semibold leading-tight tracking-tight text-foreground sm:text-2xl">{displayName}</h1>
          </div>
        </div>
        <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-md border border-border bg-secondary/60 px-3 py-1.5 text-xs font-semibold text-foreground lg:self-center">
          <span className="h-2 w-2 rounded-full" style={{ background: NAVY }} /> {statusLabel}
        </span>
      </div>

      <dl className="grid grid-cols-2 border-b border-border sm:grid-cols-3 lg:grid-cols-6 lg:divide-x lg:divide-border">
        {details.map((item, index) => (
          <div key={item.label} className={`min-w-0 px-5 py-3 ${index >= 2 ? "border-t border-border lg:border-t-0" : ""} ${index === 1 || index === 3 || index === 5 ? "" : ""}`}>
            <dt className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</dt>
            <dd className={`mt-0.5 truncate text-sm font-semibold text-foreground ${item.mono ? "font-mono" : ""}`} title={String(item.value ?? "")}>{item.value || "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto px-5 py-5 sm:px-6">
        <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(5.5rem, 1fr))` }}>
          {steps.map((step, index) => {
            const done = index < currentIndex;
            const active = index === currentIndex;
            return (
              <li key={`${step}-${index}`} className="relative flex flex-col items-center text-center">
                {index > 0 && (
                  <span aria-hidden="true" className="absolute right-1/2 top-3 h-px w-full -translate-y-1/2" style={{ background: index <= currentIndex ? NAVY : TRACK }} />
                )}
                <span
                  className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 bg-card text-white"
                  style={{ borderColor: done || active ? NAVY : TRACK, background: done ? NAVY : undefined }}
                >
                  {done ? <Ic.Check /> : active ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                </span>
                <span className={`mt-2 px-1 text-[0.7rem] leading-tight sm:text-xs ${active ? "font-semibold text-foreground" : done ? "font-medium text-foreground" : "text-muted-foreground"}`}>{step}</span>
                <span className="mt-0.5 text-[0.65rem] text-muted-foreground">{done ? "Completed" : active ? "In progress" : "Pending"}</span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/* ── Charts (plain SVG) ── */
// The same small palette the Admin dashboard uses for its dots and bars: the theme blue for the main figure, green = done, purple and amber as accents,
// and a neutral track. Colour is used sparingly - dots, bars, rings - never as a filled block.
const NAVY = "hsl(var(--primary))";
const GREEN = "#10b981";
const PURPLE = "#8b5cf6";
const AMBER = "#f59e0b";
const TRACK = "hsl(var(--border))";
// the chart blue (the same blue as the bars on the Admin dashboard) used wherever a chart or dot needs "blue"
const CHART_BLUE = "#2563eb";

// segments: [{ value, color }]; the rest of the ring is the soft track
function DonutChart({ segments, total, center, sub, size = 108, stroke = 10 }) {
  // (a chart whose data has not arrived yet passes center="—": it draws only the empty track)
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const sum = total ?? segments.reduce((acc, segment) => acc + segment.value, 0);
  let offset = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="hsl(var(--secondary))" strokeWidth={stroke} />
        {sum > 0 && segments.map((segment, index) => {
          const length = (Math.max(0, segment.value) / sum) * circumference;
          const circle = length > 0 ? (
            <circle key={index} cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={segment.color} strokeWidth={stroke}
              strokeDasharray={`${length} ${circumference}`} strokeDashoffset={-offset} />
          ) : null;
          offset += length;
          return circle;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-semibold leading-none tabular-nums text-foreground">{center}</span>
        {sub && <span className="mt-1 text-[0.62rem] font-medium uppercase tracking-wide text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, chart, legend }) {
  return (
    <div className="rounded-lg border border-card-border bg-card p-5">
      <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
      <div className="mt-4 flex items-center gap-5">
        {chart}
        <ul className="min-w-0 flex-1 space-y-2">
          {legend.map((item) => (
            <li key={item.label} className="flex items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground"><span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: item.color }} /><span className="truncate">{item.label}</span></span>
              <span className="font-semibold tabular-nums text-foreground">{item.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// How many of the profile's key details are filled in. The fields are read from the same places the Profile page reads them (a client's intake
// record; an invited employee's canonical profile), so this number can never disagree with what the Profile page shows. null = not known yet.
const PROFILE_FIELDS = ["firstName", "lastName", "email", "primaryPhone", "address", "city", "state", "zipCode", "country"];
const canonicalValue = (profile, path) => path.split(".").reduce((current, key) => current?.[key], profile?.canonicalData)?.value || "";

async function loadProfileFields({ isEmployee, caseId, user }) {
  if (isEmployee) {
    if (!caseId) return null;
    const result = await employeeProfileApi.get(caseId);
    const profile = result?.profile || {};
    return {
      firstName: canonicalValue(profile, "firstName"), lastName: canonicalValue(profile, "lastName"), email: canonicalValue(profile, "email") || user?.email || "",
      primaryPhone: canonicalValue(profile, "phone"), address: canonicalValue(profile, "currentAddress.street"), city: canonicalValue(profile, "currentAddress.city"),
      state: canonicalValue(profile, "currentAddress.state"), zipCode: canonicalValue(profile, "currentAddress.zipCode"), country: canonicalValue(profile, "currentAddress.country"),
    };
  }
  const result = await profileApi.getIntake();
  const client = result?.intake?.client || {};
  return { ...client, email: client.email || user?.email || "" };
}

function profileCompletion(fields, markedComplete) {
  if (markedComplete) return 100;
  if (!fields) return null;
  const filled = PROFILE_FIELDS.filter((key) => String(fields[key] ?? "").trim()).length;
  return Math.round((filled / PROFILE_FIELDS.length) * 100);
}

/* ── Newsletter: the newest official USCIS form editions, straight from the forms library ── */
function NewsletterCard() {
  const { data, isPending, isError } = useQuery({ queryKey: ["public-forms"], queryFn: () => api.get("/public-forms"), retry: false, staleTime: 5 * 60 * 1000 });
  const latest = useMemo(() => [...(data?.data || [])]
    .filter((form) => form.editionDate)
    .sort((a, b) => new Date(b.editionDate) - new Date(a.editionDate))
    .slice(0, 4), [data]);
  const open = (formCode) => window.open(`${API_BASE_URL}/public-forms/${encodeURIComponent(formCode)}/pdf`, "_blank", "noopener");
  return (
    <div className="overflow-hidden rounded-lg border border-card-border bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Immigration newsletter</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Newest official USCIS form editions</p>
        </div>
        <Link to="/dashboard/forms" className="shrink-0 text-xs font-semibold text-primary no-underline hover:underline">View all</Link>
      </div>
      {isPending ? (
        <div className="space-y-3 p-5" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-secondary" />)}</div>
      ) : isError || !latest.length ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">No form updates to show right now.</p>
      ) : (
        <ul className="divide-y divide-border">
          {latest.map((form) => (
            <li key={form.formCode} className="flex items-center gap-3 px-5 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><Ic.Docs /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{form.formCode} <span className="font-normal text-muted-foreground">· {form.title}</span></p>
                <p className="text-xs text-muted-foreground">New edition · {fmtDate(form.editionDate)}</p>
              </div>
              <button type="button" onClick={() => open(form.formCode)} className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/5">Read</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── KPI tiles: a small coloured dot before the label, like the Admin dashboard ── */
function KpiCard({ label, value, hint, to, color }) {
  return (
    <Link to={to} className="group block rounded-lg border border-card-border bg-card px-5 py-4 no-underline transition-colors hover:border-primary/40">
      <p className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-wide text-muted-foreground">
        <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden="true" /> {label}
      </p>
      <p className="mt-2 text-2xl font-semibold leading-none tabular-nums text-foreground">{value}</p>
      <p className="mt-1.5 truncate text-xs text-muted-foreground">{hint}</p>
    </Link>
  );
}

/* ── Case Details (client-facing summary card, matches Immiglance reference) ── */
function CaseDetailsCard({ caseData, profileData, user }) {
  const email = profileData?.email || user?.email || "—";
  const phone = profileData?.primaryPhone || caseData?.clientPhone || "—";
  const submitted = fmtDate(caseData?.createdAt);
  return (
    <div className="bg-card rounded-lg border border-card-border p-6">
      <h2 className="font-serif text-lg font-bold text-foreground mb-4">Case Details</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Category</p>
          <p className="text-sm font-semibold text-foreground">{caseData?.visaCategory || "Not selected"}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Email</p>
          <p className="text-sm font-semibold text-foreground truncate">{email}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Phone</p>
          <p className="text-sm font-semibold text-foreground">{phone}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Submitted</p>
          <p className="text-sm font-semibold text-foreground">{submitted}</p>
        </div>
      </div>
    </div>
  );
}

/* ── Signed Declaration (client-facing summary card, matches Immiglance
   reference) — only rendered once PlanSelection.jsx's Review & Sign step has
   actually captured one; a case with no declaration yet renders nothing
   here rather than a placeholder. ── */
function SignedDeclarationCard({ caseData }) {
  const declaration = caseData?.signedDeclaration;
  if (!declaration?.signedName) return null;
  return (
    <div className="bg-card rounded-lg border border-card-border p-6">
      <h2 className="font-serif text-lg font-bold text-foreground mb-4">Signed Declaration</h2>
      <div className="flex items-center gap-4">
        <div className="flex-1 min-w-0 rounded-xl border border-border bg-secondary px-5 py-4">
          <p className="font-serif italic text-xl text-foreground truncate">{declaration.signedName}</p>
        </div>
        <div className="shrink-0">
          <p className="text-sm font-semibold text-foreground">{declaration.signedName}</p>
          <p className="text-xs text-muted-foreground">Signed {fmtDate(declaration.signedAt)}</p>
        </div>
      </div>
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
  useEffect(() => {
    document.title = "Dashboard | Immiglance";
  }, []);

  const isEmployee = isEmployeeAccount(user);

  // Perf fix: previously three sequential/parallel raw fetches
  // (profileApi.get(), casesApi.my(), then casesApi.workflow() awaited
  // before addons could even start) rebuilt from scratch on every mount.
  // useMyCase()/useMyProfile() are the same shared TanStack Query cache
  // Documents/Messages/PlanSelection/Profile already read from — a page nav
  // between those and here can now serve this from cache instead of
  // refetching. The workflow fetch stays its own dependent query (it needs
  // the case _id first), but is no longer nested inside loadCase's body —
  // addons (below) fires off the same _id independently instead of waiting
  // for workflow to resolve first.
  const { data: profileData = {} } = useMyProfile();
  const profileComplete = profileData.completed || false;

  const { data: rawCase, error: caseError, isPending: caseIsPending, refetch: refetchCase } = useMyCase();
  const normalizedCase = rawCase?.case || rawCase?.data?.case || rawCase;
  const caseId = normalizedCase?._id;
  const caseLoadError = caseError
    ? (caseError.message || "Unable to load your case right now.")
    : "";

  const queryClient = useQueryClient();
  const { data: workflowRaw } = useQuery({
    queryKey: ["case", "workflow", caseId],
    queryFn: () => casesApi.workflow(caseId),
    enabled: Boolean(caseId),
    refetchInterval: 30 * 1000,
  });
  // Anything that changes on this case (a document reviewed, a checklist approved, a stage moved in the pipeline, a message) refreshes the figures at once.
  useCaseDataChanged(caseId, () => {
    ["case", "documents", "messages", "profile", "checklists"].forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
  });
  const workflow = workflowRaw?.workflow || workflowRaw?.data?.workflow || workflowRaw?.data || workflowRaw;

  const caseData = useMemo(() => {
    if (!normalizedCase) return null;
    return {
      ...normalizedCase,
      currentStage: normalizeCaseStage(normalizedCase),
      journeyProgress: workflow?.progress || normalizedCase.journeyProgress,
      timeline: workflow?.timeline || normalizedCase.timeline,
    };
  }, [normalizedCase, workflow]);

  const displayName = profileData.firstName
    ? `${profileData.firstName}${profileData.lastName ? " " + profileData.lastName : ""}`
    : user?.displayName || user?.email?.split("@")[0] || "Client";

  const activeCaseData = caseData || {
    caseId:        "Pending",
    visaCategory:  "Not Selected",
    visaType:      "Not Assigned",
    currentStage:  0,
    assignedAgent: "Immiglance Team",
    createdAt:     new Date().toISOString(),
    uscisNumber:   "Pending Assignment",
    priority:      "Standard Processing",
  };

  // Perf fix: first-mount-only loading signal (true until useMyCase resolves
  // for the first time, false on every later background refetch) — drives
  // the KPI grid/case progress tracker/activity feed skeletons below instead
  // of those sections silently rendering their "Pending"/zeroed placeholder
  // values for the whole duration of the initial fetch.
  const isInitialCaseLoading = caseIsPending && !caseError;

  // The case's GoHighLevel pipeline stages (null when it is not on a pipeline: the standard steps are shown then).
  const LIVE = { retry: false, refetchInterval: 30 * 1000 };
  const { data: pipelineRaw } = useQuery({ queryKey: ["case", "pipeline", caseId], queryFn: casesApi.myPipeline, enabled: Boolean(caseId), ...LIVE });
  const pipeline = pipelineRaw?.pipeline || null;

  // The figures below are read from the database, never assumed: each is its own small query that refreshes every 30 s and whenever the case changes.
  // Until a figure has arrived (or if it cannot be read) the tile shows a dash, never a made-up zero.
  const { data: documentCountRaw } = useQuery({ queryKey: ["documents", "me", "count"], queryFn: documentsApi.count, ...LIVE });
  const { data: unreadRaw } = useQuery({ queryKey: ["messages", "unread-count"], queryFn: messagesApi.getUnreadCount, ...LIVE });
  const { data: profileFields } = useQuery({
    queryKey: ["profile", "fields", isEmployee ? "employee" : "client", caseId || "none"],
    queryFn: () => loadProfileFields({ isEmployee, caseId, user }),
    enabled: !isEmployee || Boolean(caseId),
    ...LIVE,
  });
  // Same list and same cache entry as the Documents page, so a "Save progress" or "Submit" there is reflected here the moment it is saved: the server pushes
  // a change event (which re-reads this), and it is also re-read every 30 s and whenever this page opens.
  const { data: checklistList } = useQuery({
    queryKey: ["checklists", "case", caseId],
    queryFn: async () => (await questionnairesApi.listCaseChecklists(caseId)).data?.checklists || [],
    enabled: Boolean(caseId),
    retry: false,
    refetchInterval: 30 * 1000,
    refetchOnMount: "always",
  });
  const checklistTotal = checklistList ? checklistList.reduce((sum, item) => sum + (Number(item.progress?.totalQuestions) || 0), 0) : null;
  const checklistAnswered = checklistList ? checklistList.reduce((sum, item) => sum + (Number(item.progress?.answeredTotal) || 0), 0) : null;
  const numberOrNull = (value) => (value !== undefined && value !== null && Number.isFinite(Number(value)) ? Number(value) : null);
  const documentCount = numberOrNull(documentCountRaw?.count);
  const unreadMessages = numberOrNull(unreadRaw?.unreadCount ?? unreadRaw?.count);
  // "Tasks" are the case's lifecycle milestones - the very list the Tasks page shows
  const milestones = workflowRaw?.workflow?.progress?.milestones || workflowRaw?.data?.progress?.milestones || null;
  const taskTotal = milestones ? milestones.length : null;
  const closedTaskCount = milestones ? milestones.filter((milestone) => milestone.completed).length : null;
  const openTaskCount = milestones ? taskTotal - closedTaskCount : null;
  const profilePercent = profileCompletion(profileFields, profileComplete);
  const profileKnown = profilePercent !== null;
  const profileShown = profileKnown ? `${profilePercent}%` : "—";

  return (
    <div className="min-h-screen bg-background">

      {notice && (
        <div className="bg-primary/10 border-b border-primary/20 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-primary">{notice}</p>
          <button onClick={() => setNotice("")} aria-label="Dismiss" className="text-primary hover:opacity-80 shrink-0">
            <Ic.X />
          </button>
        </div>
      )}

      {caseLoadError && (
        <div className="bg-destructive/10 border-b border-destructive/20 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-destructive">{caseLoadError}</p>
          <button
            onClick={() => refetchCase()}
            className="text-sm font-bold text-destructive hover:opacity-80 shrink-0"
          >
            Retry
          </button>
        </div>
      )}

      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 pb-4 pt-6 sm:px-6 sm:pt-8">

        <div id="case-progress">
          {isInitialCaseLoading ? <CaseProgressSkeleton /> : (
            <CaseStatusStepper caseData={activeCaseData} profileData={profileData} user={user} displayName={displayName} pipeline={pipeline} />
          )}
        </div>

        {/* ── KPI tiles ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <KpiCard label="Tasks" value={openTaskCount ?? "—"} hint={openTaskCount === null ? "Loading" : openTaskCount ? `${closedTaskCount} of ${taskTotal} done` : "All done"} to="/dashboard/tasks" color={CHART_BLUE} />
          <KpiCard label="Documents" value={documentCount ?? "—"} hint="Uploaded" to="/dashboard/documents" color={GREEN} />
          <KpiCard label="Messages" value={unreadMessages ?? "—"} hint="Unread" to="/dashboard/messages" color={PURPLE} />
          <KpiCard label="Profile" value={profileShown} hint={!profileKnown ? "Loading" : profilePercent === 100 ? "Complete" : "Finish to proceed"} to="/dashboard/profile" color={AMBER} />
        </div>

        {/* ── Charts ── */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <ChartCard
            title="Your tasks"
            subtitle={taskTotal ? "Your case checklist" : "Your case checklist will appear here"}
            chart={<DonutChart segments={[{ value: closedTaskCount || 0, color: GREEN }, { value: openTaskCount || 0, color: CHART_BLUE }]} total={taskTotal || 0} center={taskTotal ? `${closedTaskCount}/${taskTotal}` : "—"} sub="done" />}
            legend={[
              { label: "Open", value: openTaskCount ?? "—", color: CHART_BLUE },
              { label: "Done", value: closedTaskCount ?? "—", color: GREEN },
            ]}
          />
          <ChartCard
            title="Documents uploaded"
            subtitle={checklistTotal ? "Questions answered in your checklist" : checklistList ? "No checklist assigned yet" : "Loading"}
            chart={<DonutChart segments={[{ value: checklistAnswered || 0, color: CHART_BLUE }]} total={checklistTotal || 0} center={checklistTotal ? `${checklistAnswered}/${checklistTotal}` : checklistList ? "0" : "—"} sub={checklistTotal ? "answered" : "no checklist"} />}
            legend={[
              { label: "Answered", value: checklistAnswered ?? "—", color: CHART_BLUE },
              { label: "Remaining", value: checklistTotal === null ? "—" : checklistTotal - checklistAnswered, color: TRACK },
              { label: "Total questions", value: checklistTotal ?? "—", color: "hsl(var(--muted-foreground) / 0.5)" },
            ]}
          />
          <ChartCard
            title="Profile"
            subtitle={profilePercent === 100 ? "All set" : "Complete it to proceed with your case"}
            chart={<DonutChart segments={[{ value: profilePercent || 0, color: PURPLE }]} total={100} center={profileShown} sub="complete" />}
            legend={[
              { label: "Filled in", value: profileShown, color: PURPLE },
              { label: "Still to add", value: profileKnown ? `${100 - profilePercent}%` : "—", color: TRACK },
            ]}
          />
        </div>

        {!profileComplete && profilePercent !== 100 && (
          <Link to="/dashboard/profile" className="flex items-center justify-between gap-4 rounded-lg border border-card-border border-l-4 bg-card px-5 py-3.5 no-underline transition-colors hover:bg-secondary/40" style={{ borderLeftColor: NAVY }}>
            <div>
              <p className="text-sm font-semibold text-foreground">Complete your profile</p>
              <p className="text-xs text-muted-foreground">It takes a couple of minutes and lets your team move your case forward.</p>
            </div>
            <span className="shrink-0 rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">Continue</span>
          </Link>
        )}

        {/* ── Main columns ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <NewsletterCard />

            {isEmployee && <MyTasksCard caseData={caseData} role="employee" />}
            {/* Real employer_employee cases (verified against production data)
                never set user.role/applicantType to "employer" - every principal
                account is role:"client", applicantType:"individual". The
                authoritative signal for "this is the employer/principal side"
                is the CASE's own caseRole (Documents.jsx's PrincipalCaseWorkspace
                branch uses the same field), not anything on the user record. */}
            {caseData?.caseRole === "principal" && <MyTasksCard caseData={caseData} role="employer" />}

            {(activeCaseData.expertLetters?.length > 0 || activeCaseData.attorneyReview?.required) && (
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                <ExpertLettersCard letters={activeCaseData.expertLetters} />
                <AttorneyReviewCard review={activeCaseData.attorneyReview} />
              </div>
            )}

            <CaseDetailsCard caseData={activeCaseData} profileData={profileData} user={user} />
            <SignedDeclarationCard caseData={activeCaseData} />
          </div>

          <div className="space-y-6">
            <QuickActions profileComplete={profileComplete} />
            <CaseInfo caseData={activeCaseData} profileData={profileData} />
            {!isEmployee && <PaymentSummaryCard plan={activeCaseData?.plan} />}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground pb-4">© 2026 Immiglance</p>
      </div>
    </div>
  );
}
