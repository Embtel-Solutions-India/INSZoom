import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { resolveDisplayVisa } from "../../utils/visaDisplay";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { isEmployeeAccount } from "../../utils/auth";
import { casesApi } from "../../services/api";
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

function UpgradeServicesCard({ addons, purchased = [], loading, purchasing, error, onPurchase }) {
  const premium = addons.find((item) => item.key === "premium_processing_i907");
  const purchasedPremium = purchased.find((item) => item.key === "premium_processing_i907");
  if (!premium && !purchasedPremium && !loading) return null;
  return (
    <div className="bg-card rounded-lg border border-card-border p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-[0.72rem] font-bold uppercase tracking-wider text-primary">Upgrade Services</p>
          <h2 className="font-serif text-lg font-bold text-foreground mt-1">Available Upgrades</h2>
          <p className="text-sm text-muted-foreground mt-1">Add eligible services to this case without creating a new case.</p>
        </div>
        {purchasedPremium && (
          <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-extrabold uppercase tracking-wide text-primary">
            {purchasedPremium.paymentStatus === "paid" ? "Paid" : purchasedPremium.status?.replace(/_/g, " ")}
          </span>
        )}
      </div>
      {loading ? (
        <p className="mt-4 text-sm font-semibold text-muted-foreground">Checking available upgrades...</p>
      ) : purchasedPremium ? (
        <div className="mt-4 rounded-xl border border-primary/20 bg-primary/10 p-4">
          <p className="font-bold text-foreground">Premium Processing (I-907)</p>
          <p className="text-sm text-primary mt-1">This upgrade is attached to your existing case.</p>
        </div>
      ) : premium ? (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-xl border border-card-border bg-secondary p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-extrabold text-foreground">Premium Processing (Form I-907)</p>
                <p className="text-sm text-muted-foreground">Processing Time: {premium.processingTime}</p>
              </div>
              <p className="text-2xl font-black text-foreground">{moneyFromCents(premium.totalFeeCents)}</p>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-lg bg-card p-3">
                <p className="text-xs text-muted-foreground">Government Fee</p>
                <p className="font-bold text-foreground">{moneyFromCents(premium.governmentFeeCents)}</p>
              </div>
              <div className="rounded-lg bg-card p-3">
                <p className="text-xs text-muted-foreground">Attorney Fee</p>
                <p className="font-bold text-foreground">{moneyFromCents(premium.attorneyFeeCents)}</p>
              </div>
              <div className="rounded-lg bg-card p-3">
                <p className="text-xs text-muted-foreground">Related Form</p>
                <p className="font-bold text-foreground">{premium.form}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {(premium.eligibility?.checks || []).map((check) => (
                <div key={check.key} className="flex items-center gap-2 text-sm">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full ${check.passed ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Ic.Check />
                  </span>
                  <span className={check.passed ? "text-foreground" : "text-muted-foreground"}>{check.label}</span>
                </div>
              ))}
            </div>
            {!premium.eligibility?.available && (
              <div className="mt-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm font-semibold text-destructive">
                Premium Processing is not available for this petition.
              </div>
            )}
            {error && <p className="mt-3 text-sm font-semibold text-destructive">{error}</p>}
          </div>
          <button
            type="button"
            onClick={() => onPurchase(premium.key)}
            disabled={!premium.eligibility?.available || purchasing}
            className="rounded-xl bg-primary px-5 py-3 text-sm font-extrabold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:bg-muted"
          >
            {purchasing ? "Starting checkout..." : "Add Upgrade"}
          </button>
        </div>
      ) : null}
    </div>
  );
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

function ActivityFeedSkeleton() {
  return (
    <div className="bg-card rounded-lg border border-card-border p-5 animate-pulse" aria-hidden="true">
      <div className="h-3.5 w-28 bg-secondary rounded mb-4" />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="h-3 w-3/4 bg-muted rounded mb-2" />
              <div className="h-2.5 w-1/3 bg-muted rounded" />
            </div>
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
            <h3 className="font-extrabold text-foreground text-sm">Payment Summary</h3>
            <p className="text-xs text-muted-foreground">
              {PLAN_LABELS[plan.tier] || "No plan selected"}
            </p>
          </div>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-muted-foreground">Total Fee</span>
            <span className="text-sm font-extrabold text-foreground">{formattedAmount}</span>
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

          <Link
            to="/dashboard/payments"
            className="block text-center mt-4 rounded-xl bg-primary/10 border border-primary/20 text-primary font-extrabold text-sm py-2.5 no-underline hover:bg-primary/15 transition"
          >
            View Payment Details
          </Link>
        </div>
      </div>
    );
  }

/* ── Activity Feed ──────────────────────────────────────────────────────────── */
function ActivityFeed({ caseData, profileSavedAt }) {
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

  const items = timelineItems.length ? timelineItems : [
    caseData ? {
      time: timeAgo(caseData.updatedAt || caseData.createdAt),
      text: `Case status is ${String(caseData.status || "active").replace(/_/g, " ")} at ${CASE_STAGES[normalizeCaseStage(caseData)]?.label || "Intake"}.`,
      type: caseData.status === "pending_assignment" ? "warn" : "info",
    } : null,
    profileSavedAt ? { time: timeAgo(profileSavedAt), text: "Your profile information was saved.", type: "success" } : null,
    { time: "Just now", text: "Welcome to the Immiglance Client Portal.", type: "success" },
  ].filter(Boolean);

  // Theme-token only (no raw colors) — success is the one signal worth
  // calling out visually (primary accent); info/warn both read as plain rows.
  const typeStyles = {
    success: { dot: "bg-primary", bg: "bg-primary/10" },
    info:    { dot: "bg-muted-foreground/40", bg: "" },
    warn:    { dot: "bg-destructive", bg: "bg-destructive/5" },
  };

  return (
    <div className="bg-card rounded-lg border border-card-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-secondary text-muted-foreground flex items-center justify-center">
          <Ic.Clock />
        </div>
        <h3 className="font-extrabold text-foreground text-sm">Recent Activity</h3>
      </div>
      <ul className="divide-y divide-border">
        {items.map((item, i) => {
          const s = typeStyles[item.type] || typeStyles.info;
          return (
            <li key={i} className={`flex items-start gap-3 px-5 py-3.5 ${i === 0 ? s.bg : ""}`}>
              <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${s.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground leading-snug">{item.text}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{item.time}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function agentInitials(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "?";
  return trimmed.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

/* ── Case Info Card ─────────────────────────────────────────────────────────── */
function CaseInfo({ caseData, profileData }) {
  return (
    <div className="bg-card rounded-lg border border-card-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
          <Ic.Shield />
        </div>
        <h3 className="font-extrabold text-foreground text-sm">Case Information</h3>
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
            <span className="text-xs font-semibold text-muted-foreground shrink-0">{label}</span>
            <span className={`text-xs font-bold text-foreground text-right truncate max-w-40 ${label === "Case ID" || label === "USCIS Receipt No." ? "font-mono" : ""}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* Assigned agent */}
      <div className="px-5 py-4 border-t border-border bg-secondary">
        <p className="text-[0.68rem] font-extrabold uppercase tracking-wider text-muted-foreground mb-3">Assigned Agent</p>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary
            flex items-center justify-center text-primary-foreground font-extrabold text-sm shrink-0">
            {agentInitials(caseData.assignedAgent)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">{caseData.assignedAgent}</p>
            <p className="text-xs text-muted-foreground">Immigration Consultant</p>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Link to="/dashboard/messages"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold
              bg-card border border-card-border rounded-lg text-muted-foreground hover:bg-muted transition no-underline">
            <Ic.Mail /> Message
          </Link>
          <a href="tel:+15107708700"
            className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-bold
              bg-primary/10 border border-primary/20 rounded-lg text-primary hover:bg-primary/15 transition no-underline">
            <Ic.Phone /> Call
          </a>
        </div>
      </div>
    </div>
  );
}

/* ── Quick Actions ──────────────────────────────────────────────────────────── */
function QuickActions({ profileComplete }) {
  const actions = [
    { label: "Complete Profile", to: "/dashboard/profile",   icon: Ic.User,   done: profileComplete },
    { label: "Upload Documents", to: "/dashboard/documents", icon: Ic.Upload, done: false },
    { label: "View Case Status", to: null, scrollTo: "case-progress", icon: Ic.Shield, done: false },
    { label: "Contact Agent",    to: "/dashboard/messages", icon: Ic.Agent, done: false },
  ];

  const btnClass = "relative flex flex-col items-center gap-2 py-4 px-3 rounded-lg border border-card-border bg-card"
    + " text-foreground text-center no-underline transition-colors hover:bg-secondary cursor-pointer";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {actions.map((a) => {
        const inner = (
          <>
            {a.done && (
              <span className="absolute top-2 right-2 w-4 h-4 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Ic.Check />
              </span>
            )}
            <span className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <a.icon />
            </span>
            <span className="text-xs font-bold leading-tight">{a.label}</span>
          </>
        );

        if (a.scrollTo) {
          return (
            <button key={a.label} onClick={() => {
              document.getElementById(a.scrollTo)?.scrollIntoView({ behavior: "smooth" });
            }} className={btnClass}>
              {inner}
            </button>
          );
        }
        return (
          <Link key={a.label} to={a.to} className={btnClass}>
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
  not_started:              "bg-secondary text-muted-foreground border-border",
  professor_assigned:       "bg-secondary text-muted-foreground border-border",
  draft_in_progress:        "bg-accent text-accent-foreground border-accent-foreground/20",
  professor_review_pending: "bg-accent text-accent-foreground border-accent-foreground/20",
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
          <h3 className="font-extrabold text-foreground text-sm">Expert Letters</h3>
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
  pending_review: "bg-accent text-accent-foreground border-accent-foreground/20",
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
          <h3 className="font-extrabold text-foreground text-sm">Attorney Review</h3>
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

/* ── My Tasks (invited-employee view) — open information requests from the case manager/employer ── */
function MyTasksCard({ caseData }) {
  const openTasks = (caseData?.informationRequests || []).filter((item) => item.target === "employee" && item.status === "open");
  return (
    <div className="bg-card rounded-lg border border-card-border overflow-hidden">
      <div className="px-5 py-4 border-b border-border flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-secondary text-muted-foreground flex items-center justify-center">
          <Ic.Alert />
        </div>
        <div>
          <h3 className="font-extrabold text-foreground text-sm">My Tasks</h3>
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

/* ── Case Status (client-facing 5-step summary, matches Immiglance reference) ── */
function CaseStatusStepper({ caseData }) {
  const currentIndex = resolveCaseStepIndex(caseData);
  return (
    <div className="bg-card rounded-lg border border-card-border p-6">
      <h2 className="font-serif text-lg font-bold text-foreground mb-4">Case Status</h2>
      <ul className="space-y-4">
        {CASE_STATUS_STEPS.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li key={step} className="flex items-center gap-3">
              <span className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center
                ${done ? "bg-primary border-primary text-primary-foreground"
                  : active ? "border-primary text-primary"
                  : "border-border text-transparent"}`}>
                {done ? <Ic.Check /> : active ? <span className="w-2 h-2 rounded-full bg-primary" /> : null}
              </span>
              <span className={`text-sm ${active ? "font-bold text-foreground" : done ? "text-foreground" : "text-muted-foreground"}`}>
                {step}
              </span>
              {active && (
                <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-secondary text-foreground">
                  Current
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
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
  const [availableAddons, setAvailableAddons] = useState([]);
  const [purchasedAddons, setPurchasedAddons] = useState([]);
  const [addonsLoading, setAddonsLoading] = useState(false);
  const [purchasingAddon, setPurchasingAddon] = useState(false);
  const [addonError, setAddonError] = useState("");

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

  const { data: workflowRaw } = useQuery({
    queryKey: ["case", "workflow", caseId],
    queryFn: () => casesApi.workflow(caseId),
    enabled: Boolean(caseId),
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

  // Addons only ever needed the case _id — previously nested inside
  // loadCase()'s body, so it waited on the (unrelated) workflow fetch to
  // resolve first. Now fires as soon as caseId is known, independently of
  // the workflow query above and on its own loading state, same shape as
  // before (setAddonsLoading/setAvailableAddons/setAddonError).
  useEffect(() => {
    if (isEmployee || !caseId) return;
    let cancelled = false;
    setAddonsLoading(true);
    casesApi.addons(caseId)
      .then((response) => {
        if (cancelled) return;
        setAvailableAddons(response.addons || []);
        setPurchasedAddons(response.purchased || normalizedCase?.addons || []);
        setAddonError("");
      })
      .catch((error) => {
        if (cancelled) return;
        setAvailableAddons([]);
        setPurchasedAddons(normalizedCase?.addons || []);
        setAddonError(error.message || "Unable to load upgrades.");
      })
      .finally(() => { if (!cancelled) setAddonsLoading(false); });
    return () => { cancelled = true; };
    // normalizedCase is deliberately excluded — addons only need to reload
    // when the active case changes (caseId), not on every case-data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, isEmployee]);

  const handlePurchaseAddon = async (addonKey) => {
    if (!caseId || purchasingAddon) return;
    setPurchasingAddon(true);
    setAddonError("");
    try {
      const response = await casesApi.purchaseAddon(caseId, addonKey);
      if (response.checkout?.url) {
        window.location.href = response.checkout.url;
        return;
      }
      await refetchCase();
      const refreshed = await casesApi.addons(caseId).catch(() => null);
      if (refreshed) {
        setAvailableAddons(refreshed.addons || []);
        setPurchasedAddons(refreshed.purchased || []);
      }
    } catch (error) {
      setAddonError(error.message || "Unable to start upgrade checkout.");
    } finally {
      setPurchasingAddon(false);
    }
  };

  const savedAt = profileData?.updatedAt;

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

  return (
    <div className="min-h-screen bg-background">

      {notice && (
        <div className="bg-accent border-b border-accent-foreground/20 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-accent-foreground">{notice}</p>
          <button onClick={() => setNotice("")} aria-label="Dismiss" className="text-accent-foreground hover:opacity-80 shrink-0">
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

      {/* ── Overview header ── */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-2">
        <h1 className="font-serif text-2xl font-bold text-foreground">Case Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {activeCaseData.visaCategory && activeCaseData.visaCategory !== "Not Selected"
            ? `${resolveDisplayVisa(activeCaseData)} case for ${displayName}.`
            : `Case for ${displayName}.`}
        </p>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-7 space-y-6">

        <div id="case-progress">
          {isInitialCaseLoading ? <CaseProgressSkeleton /> : (
            <CaseStatusStepper caseData={activeCaseData} />
          )}
        </div>

        <CaseDetailsCard caseData={activeCaseData} profileData={profileData} user={user} />

        {!profileComplete && (
          <div className="bg-accent border border-accent-foreground/20 rounded-lg px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Ic.Alert />
              <span className="text-sm font-semibold text-accent-foreground">Complete your profile to proceed with your case.</span>
            </div>
            <Link to="/dashboard/profile" className="text-sm font-bold text-accent-foreground hover:opacity-80 no-underline shrink-0">
              Complete Profile →
            </Link>
          </div>
        )}

        {/* ── Quick Actions ── */}
        <QuickActions profileComplete={profileComplete} />

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

        {/* ── Expert Letters + Attorney Review ── */}
        {(activeCaseData.expertLetters?.length > 0 || activeCaseData.attorneyReview?.required) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <ExpertLettersCard letters={activeCaseData.expertLetters} />
            <AttorneyReviewCard review={activeCaseData.attorneyReview} />
          </div>
        )}

        {/* ── Activity + Case Info ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {isInitialCaseLoading ? <ActivityFeedSkeleton /> : <ActivityFeed caseData={caseData} profileSavedAt={savedAt} />}
          <CaseInfo caseData={activeCaseData} profileData={profileData} />
          {!isEmployee && <PaymentSummaryCard plan={activeCaseData?.plan} />}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground pb-4">© 2026 Immiglance</p>
      </div>
    </div>
  );
}
