/**
 * ─────────────────────────────────────────────────────────────────────────────
 * CENTRAL PRICING CATALOG  (frontend mirror — ESM)
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirror of Backend/src/config/pricingCatalog.js. Keep PRICE_MATRIX /
 * PACKAGE_TIERS / DEFAULT_TIER_PRICES identical to the backend file.
 * All amounts are USD cents. No other frontend file may hardcode a package
 * amount — import from here instead.
 */

export const DEFAULT_CURRENCY = "USD";
export const REFERRAL_DISCOUNT_PERCENT = 10;
export const SELF_FILING_PACKAGE = "Self Filing Package";
export const ATTORNEY_REVIEW_PACKAGE = "Attorney Review Package";
export const FULL_ATTORNEY_FILING_PACKAGE = "Full Attorney Filing Package";

export const PACKAGE_TIERS = {
  [SELF_FILING_PACKAGE]: {
    id: SELF_FILING_PACKAGE,
    order: 1,
    label: SELF_FILING_PACKAGE,
    packageName: SELF_FILING_PACKAGE,
    tagline: "Self-guided filing with templates and checklists",
    badge: "SELF",
  },
  [ATTORNEY_REVIEW_PACKAGE]: {
    id: ATTORNEY_REVIEW_PACKAGE,
    order: 2,
    label: ATTORNEY_REVIEW_PACKAGE,
    packageName: ATTORNEY_REVIEW_PACKAGE,
    tagline: "Full document review plus an attorney consultation",
    badge: "REVIEW",
  },
  [FULL_ATTORNEY_FILING_PACKAGE]: {
    id: FULL_ATTORNEY_FILING_PACKAGE,
    order: 3,
    label: FULL_ATTORNEY_FILING_PACKAGE,
    packageName: FULL_ATTORNEY_FILING_PACKAGE,
    tagline: "End-to-end attorney-led filing and case management",
    badge: "FULL",
  },
};

export const DEFAULT_TIER_PRICES = { [SELF_FILING_PACKAGE]: 49900, [ATTORNEY_REVIEW_PACKAGE]: 149900, [FULL_ATTORNEY_FILING_PACKAGE]: 399900 };

export const PRICE_MATRIX = {
  // Work
  "H-1B": { [SELF_FILING_PACKAGE]: 69900, [ATTORNEY_REVIEW_PACKAGE]: 189900, [FULL_ATTORNEY_FILING_PACKAGE]: 449900 },
  "L-1":  { [SELF_FILING_PACKAGE]: 79900, [ATTORNEY_REVIEW_PACKAGE]: 219900, [FULL_ATTORNEY_FILING_PACKAGE]: 499900 },
  "O-1":  { [SELF_FILING_PACKAGE]: 99900, [ATTORNEY_REVIEW_PACKAGE]: 249900, [FULL_ATTORNEY_FILING_PACKAGE]: 599900 },
  "E-3":  { [SELF_FILING_PACKAGE]: 59900, [ATTORNEY_REVIEW_PACKAGE]: 159900, [FULL_ATTORNEY_FILING_PACKAGE]: 349900 },
  "TN":   { [SELF_FILING_PACKAGE]: 49900, [ATTORNEY_REVIEW_PACKAGE]: 129900, [FULL_ATTORNEY_FILING_PACKAGE]: 299900 },

  // Family
  "K-1":  { [SELF_FILING_PACKAGE]: 69900, [ATTORNEY_REVIEW_PACKAGE]: 179900, [FULL_ATTORNEY_FILING_PACKAGE]: 349900 },
  "K-3":  { [SELF_FILING_PACKAGE]: 69900, [ATTORNEY_REVIEW_PACKAGE]: 179900, [FULL_ATTORNEY_FILING_PACKAGE]: 349900 },
  "H-4":  { [SELF_FILING_PACKAGE]: 39900, [ATTORNEY_REVIEW_PACKAGE]: 99900,  [FULL_ATTORNEY_FILING_PACKAGE]: 199900 },
  "F-3":  { [SELF_FILING_PACKAGE]: 79900, [ATTORNEY_REVIEW_PACKAGE]: 199900, [FULL_ATTORNEY_FILING_PACKAGE]: 399900 },
  "F-4":  { [SELF_FILING_PACKAGE]: 79900, [ATTORNEY_REVIEW_PACKAGE]: 199900, [FULL_ATTORNEY_FILING_PACKAGE]: 399900 },

  // Student
  "F-1":         { [SELF_FILING_PACKAGE]: 39900, [ATTORNEY_REVIEW_PACKAGE]: 99900,  [FULL_ATTORNEY_FILING_PACKAGE]: 179900 },
  "F-1 CPT/OPT": { [SELF_FILING_PACKAGE]: 39900, [ATTORNEY_REVIEW_PACKAGE]: 99900,  [FULL_ATTORNEY_FILING_PACKAGE]: 179900 },
  "F-2":         { [SELF_FILING_PACKAGE]: 29900, [ATTORNEY_REVIEW_PACKAGE]: 79900,  [FULL_ATTORNEY_FILING_PACKAGE]: 149900 },
  "M-1":         { [SELF_FILING_PACKAGE]: 39900, [ATTORNEY_REVIEW_PACKAGE]: 99900,  [FULL_ATTORNEY_FILING_PACKAGE]: 179900 },
  "M-2":         { [SELF_FILING_PACKAGE]: 29900, [ATTORNEY_REVIEW_PACKAGE]: 79900,  [FULL_ATTORNEY_FILING_PACKAGE]: 149900 },
  "J-1":         { [SELF_FILING_PACKAGE]: 49900, [ATTORNEY_REVIEW_PACKAGE]: 119900, [FULL_ATTORNEY_FILING_PACKAGE]: 219900 },

  // Temporary / Visitor
  "B-1":  { [SELF_FILING_PACKAGE]: 29900, [ATTORNEY_REVIEW_PACKAGE]: 79900,  [FULL_ATTORNEY_FILING_PACKAGE]: 149900 },
  "B-2":  { [SELF_FILING_PACKAGE]: 29900, [ATTORNEY_REVIEW_PACKAGE]: 79900,  [FULL_ATTORNEY_FILING_PACKAGE]: 149900 },
  "H-2B": { [SELF_FILING_PACKAGE]: 59900, [ATTORNEY_REVIEW_PACKAGE]: 159900, [FULL_ATTORNEY_FILING_PACKAGE]: 349900 },
  "ESTA": { [SELF_FILING_PACKAGE]: 19900, [ATTORNEY_REVIEW_PACKAGE]: 49900,  [FULL_ATTORNEY_FILING_PACKAGE]: 99900 },

  // Business
  "E-1":  { [SELF_FILING_PACKAGE]: 79900, [ATTORNEY_REVIEW_PACKAGE]: 219900, [FULL_ATTORNEY_FILING_PACKAGE]: 449900 },
  "E-2":  { [SELF_FILING_PACKAGE]: 99900, [ATTORNEY_REVIEW_PACKAGE]: 249900, [FULL_ATTORNEY_FILING_PACKAGE]: 549900 },
  "EB-5": { [SELF_FILING_PACKAGE]: 149900, [ATTORNEY_REVIEW_PACKAGE]: 399900, [FULL_ATTORNEY_FILING_PACKAGE]: 899900 },

  // Green Card / Permanent / Self-Sponsored
  "EB-1":     { [SELF_FILING_PACKAGE]: 119900, [ATTORNEY_REVIEW_PACKAGE]: 299900, [FULL_ATTORNEY_FILING_PACKAGE]: 699900 },
  "EB-1A":    { [SELF_FILING_PACKAGE]: 119900, [ATTORNEY_REVIEW_PACKAGE]: 299900, [FULL_ATTORNEY_FILING_PACKAGE]: 699900 },
  "EB-2":     { [SELF_FILING_PACKAGE]: 99900,  [ATTORNEY_REVIEW_PACKAGE]: 249900, [FULL_ATTORNEY_FILING_PACKAGE]: 549900 },
  "EB-2 NIW": { [SELF_FILING_PACKAGE]: 119900, [ATTORNEY_REVIEW_PACKAGE]: 299900, [FULL_ATTORNEY_FILING_PACKAGE]: 699900 },
  "EB-3":     { [SELF_FILING_PACKAGE]: 89900,  [ATTORNEY_REVIEW_PACKAGE]: 229900, [FULL_ATTORNEY_FILING_PACKAGE]: 499900 },
};

export const normalizeTier = (t) => (PACKAGE_TIERS[t] ? t : SELF_FILING_PACKAGE);

/** Price for a visa type + tier, in USD cents. */
export function getAmountCents(visaType, tier) {
  const tierKey = normalizeTier(tier);
  return PRICE_MATRIX[visaType]?.[tierKey] ?? DEFAULT_TIER_PRICES[tierKey];
}

/** Price for a visa type + tier, in whole USD dollars. */
export function getAmountDollars(visaType, tier) {
  return getAmountCents(visaType, tier) / 100;
}

/** Format USD cents as a currency string. */
export function formatCents(cents, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(
    Number(cents || 0) / 100
  );
}

/** Ordered package option list for a given visa type (for cards). */
export function getPackagesForVisa(visaType) {
  return Object.values(PACKAGE_TIERS)
    .sort((a, b) => a.order - b.order)
    .map((t) => ({
      ...t,
      tier: t.id,
      amountCents: getAmountCents(visaType, t.id),
      amountLabel: formatCents(getAmountCents(visaType, t.id)),
    }));
}

/** Lowest price per tier across all visa types — for "From $X" displays. */
export function getStartingPricesByTier() {
  return Object.keys(PACKAGE_TIERS).reduce((acc, tier) => {
    const all = Object.values(PRICE_MATRIX).map((p) => p[tier] ?? DEFAULT_TIER_PRICES[tier]);
    acc[tier] = Math.min(...all, DEFAULT_TIER_PRICES[tier]);
    return acc;
  }, {});
}

/** Lowest/highest price per tier across all visa types — actual price depends on visa type. */
export function getPriceRangesByTier() {
  return Object.keys(PACKAGE_TIERS).reduce((acc, tier) => {
    const all = Object.values(PRICE_MATRIX).map((p) => p[tier] ?? DEFAULT_TIER_PRICES[tier]).concat(DEFAULT_TIER_PRICES[tier]);
    acc[tier] = { min: Math.min(...all), max: Math.max(...all) };
    return acc;
  }, {});
}

/** Format a min/max cents pair as a "$699 – $8,999" style range. */
export function formatCentsRange(min, max, currency = "USD") {
  if (min === max) return formatCents(min, currency);
  return `${formatCents(min, currency)} – ${formatCents(max, currency)}`;
}

/** Installment schedules for a total (cents) — mirrors backend. */
export function getInstallmentPlans(totalAmount) {
  const split = (n) => {
    const base = Math.floor(totalAmount / n);
    const rem = totalAmount - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
  };
  const two = split(2);
  const four = split(4);
  return [
    {
      key: "pay_in_full",
      label: "Pay in full",
      count: 1,
      description: "Single payment now.",
      installments: [{ sequence: 1, label: "Full payment", description: "Complete package fee.", amount: totalAmount }],
    },
    {
      key: "two_installments",
      label: "2 installments",
      count: 2,
      description: "50% now, 50% before final filing.",
      installments: two.map((amount, i) => ({
        sequence: i + 1,
        label: `Installment ${i + 1}`,
        description: i ? "Due before final filing." : "Engagement deposit due now.",
        amount,
      })),
    },
    {
      key: "four_installments",
      label: "4 installments",
      count: 4,
      description: "Onboarding, document review, attorney review, final filing.",
      installments: four.map((amount, i) => ({
        sequence: i + 1,
        label: `Installment ${i + 1}`,
        description: [
          "Onboarding deposit due now.",
          "Due after document review begins.",
          "Due before attorney review is finalized.",
          "Due before final filing submission.",
        ][i],
        amount,
      })),
    },
  ];
}
