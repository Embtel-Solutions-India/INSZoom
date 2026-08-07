/** Service plan definitions — controls features and pricing display */
import {
  ATTORNEY_REVIEW_PACKAGE,
  FULL_ATTORNEY_FILING_PACKAGE,
  SELF_FILING_PACKAGE,
} from "./pricingCatalog";

export const PLANS = [
  {
    id: FULL_ATTORNEY_FILING_PACKAGE,
    label: FULL_ATTORNEY_FILING_PACKAGE,
    tagline: "End-to-end attorney-led filing",
    price: "Contact for pricing",
    color: {
      bg: "bg-emerald-50",
      border: "border-emerald-400",
      badge: "bg-emerald-500 text-white",
      btn: "bg-emerald-600 hover:bg-emerald-700 text-white",
      text: "text-emerald-700",
      ring: "ring-emerald-400",
    },
    recommended: true,
    features: [
      "Full case handling by dedicated team",
      "Assigned case manager + attorney",
      "Expert letter coordination",
      "Complete document guidance",
      "Full USCIS filing support",
      "Unlimited messaging support",
      "Priority processing",
      "Attorney review included",
    ],
    featureAccess: {
      messaging: true,
      expertLetters: true,
      attorneyReview: true,
      fullDocumentReview: true,
      templates: true,
    },
  },
  {
    id: ATTORNEY_REVIEW_PACKAGE,
    label: ATTORNEY_REVIEW_PACKAGE,
    tagline: "Guided support & attorney review",
    price: "Contact for pricing",
    color: {
      bg: "bg-blue-50",
      border: "border-blue-400",
      badge: "bg-blue-500 text-white",
      btn: "bg-blue-600 hover:bg-blue-700 text-white",
      text: "text-blue-700",
      ring: "ring-blue-400",
    },
    recommended: false,
    features: [
      "Guided document checklist",
      "Attorney document review",
      "Case progress tracking",
      "Review certificate",
      "Messaging support",
      "Limited expert letter visibility",
    ],
    featureAccess: {
      messaging: true,
      expertLetters: false,
      attorneyReview: true,
      fullDocumentReview: false,
      templates: true,
    },
  },
  {
    id: SELF_FILING_PACKAGE,
    label: SELF_FILING_PACKAGE,
    tagline: "Self-guided with resources",
    price: "Contact for pricing",
    color: {
      bg: "bg-slate-50",
      border: "border-slate-300",
      badge: "bg-slate-500 text-white",
      btn: "bg-slate-600 hover:bg-slate-700 text-white",
      text: "text-slate-700",
      ring: "ring-slate-300",
    },
    recommended: false,
    features: [
      "Visa-specific document checklist",
      "Document templates",
      "Self-guided instructions",
      "Basic case tracking dashboard",
      "Optional attorney review (add-on)",
    ],
    featureAccess: {
      messaging: false,
      expertLetters: false,
      attorneyReview: false,
      fullDocumentReview: false,
      templates: true,
    },
  },
];

export const PLAN_LABELS = {
  [FULL_ATTORNEY_FILING_PACKAGE]: FULL_ATTORNEY_FILING_PACKAGE,
  [ATTORNEY_REVIEW_PACKAGE]: ATTORNEY_REVIEW_PACKAGE,
  [SELF_FILING_PACKAGE]: SELF_FILING_PACKAGE,
  "": "Not Selected",
};

export const PAYMENT_STATUS_LABELS = {
  not_started: "Not Started",
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};

export const PAYMENT_STATUS_COLORS = {
  not_started: "bg-slate-100 text-slate-500 border-slate-200",
  pending:     "bg-amber-100 text-amber-700 border-amber-200",
  paid:        "bg-emerald-100 text-emerald-700 border-emerald-200",
  failed:      "bg-red-100 text-red-700 border-red-200",
  refunded:    "bg-violet-100 text-violet-700 border-violet-200",
};

export function getPlanById(id) {
  return PLANS.find((p) => p.id === id) || null;
}
