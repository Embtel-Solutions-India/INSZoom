// Single status vocabulary for every item on the case Checklist (fields,
// conditional documents, reusable documents) — status is always icon + word
// together, never color alone. Derived from server-authoritative fields
// (Answer.status, Document.reviewStatus/status), never invented client-side.

export const STATUS = {
  NOT_STARTED: "not_started",
  IN_PROGRESS: "in_progress",
  UNDER_REVIEW: "under_review",
  VERIFIED: "verified",
  NEEDS_ATTENTION: "needs_attention",
};

function pathIcon(d) {
  return function StatusIcon({ className = "h-3.5 w-3.5" }) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={d} />
      </svg>
    );
  };
}

export const STATUS_META = {
  [STATUS.NOT_STARTED]: {
    label: "Not started",
    className: "border-slate-200 bg-slate-50 text-slate-500",
    icon: pathIcon("M12 7v5l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"),
  },
  [STATUS.IN_PROGRESS]: {
    label: "In progress",
    className: "border-amber-200 bg-amber-50 text-amber-700",
    icon: pathIcon("M12 4.5v4M12 15.5v4M4.5 12h4M15.5 12h4"),
  },
  [STATUS.UNDER_REVIEW]: {
    label: "Under review",
    className: "border-blue-200 bg-blue-50 text-blue-700",
    icon: pathIcon("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"),
  },
  [STATUS.VERIFIED]: {
    label: "Verified",
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: pathIcon("M5 13l4 4L19 7"),
  },
  [STATUS.NEEDS_ATTENTION]: {
    label: "Needs attention",
    className: "border-rose-200 bg-rose-50 text-rose-700",
    icon: pathIcon("M12 9v4m0 3.5h.01M10.6 4.3L2.9 18a1.5 1.5 0 001.3 2.2h15.6a1.5 1.5 0 001.3-2.2L13.4 4.3a1.5 1.5 0 00-2.8 0z"),
  },
};

export function isEmptyAnswerValue(value) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.values(value).every(isEmptyAnswerValue);
  return false;
}

// answer: the raw Answer record for one questionKey (or undefined), value:
// the answers-map value that's currently displayed (kept editable/optimistic
// before a save round-trips) — used together so "not started" reflects what's
// on screen even before the first autosave lands.
export function fieldItemStatus(answer, value) {
  if (isEmptyAnswerValue(value)) return { status: STATUS.NOT_STARTED };
  if (!answer) return { status: STATUS.IN_PROGRESS };
  if (answer.status === "approved") return { status: STATUS.VERIFIED };
  if (answer.status === "rejected") {
    return { status: STATUS.NEEDS_ATTENTION, reason: answer.rejectionReason || answer.reviewNotes || "This answer needs to be corrected." };
  }
  if (answer.status === "submitted") return { status: STATUS.UNDER_REVIEW };
  return { status: STATUS.IN_PROGRESS };
}

// files: the uploaded Document records for one document slot (documentType
// or question key).
export function documentItemStatus(files = []) {
  if (!files.length) return { status: STATUS.NOT_STARTED };
  const latest = files[files.length - 1];
  const reviewStatus = latest.reviewStatus || latest.status;
  if (reviewStatus === "approved") return { status: STATUS.VERIFIED };
  if (reviewStatus === "rejected" || reviewStatus === "needs_revision") {
    return { status: STATUS.NEEDS_ATTENTION, reason: latest.reviewNotes || latest.adminNotes || "This document needs to be re-uploaded." };
  }
  return { status: STATUS.UNDER_REVIEW };
}
