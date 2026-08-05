const DEFAULT_CURRENCY = "usd";
const PRICING_VERSION = "2026-06-enterprise-pricing-v1";
const DEFAULT_TIER_PRICES = { "self-file": 49900, standard: 149900, premium: 399900 };

const PACKAGE_ALIASES = {
  self_file: "self-file",
  guided_review: "standard",
  full_service: "premium",
  "self-file": "self-file",
  standard: "standard",
  premium: "premium",
};

function normalizeTier(tier) {
  return PACKAGE_ALIASES[tier] || "self-file";
}

function resolveBasePrice(visaType, tier) {
  const tierKey = normalizeTier(tier);
  return {
    tierKey,
    packageKey: tierKey,
    packageName: {
      "self-file": "Self-File Package",
      standard: "Guided Review Package",
      premium: "Full Service Filing Package",
    }[tierKey],
    visaType: visaType || "",
    baseAmount: DEFAULT_TIER_PRICES[tierKey],
    currency: DEFAULT_CURRENCY,
    pricingVersion: PRICING_VERSION,
  };
}

function applyDiscounts(baseAmount, discounts = []) {
  let discountAmount = 0;
  const normalized = discounts.map((discount) => {
    const amountOff = discount.amountOff || Math.round(baseAmount * ((discount.percentOff || 0) / 100));
    const appliedAmount = Math.max(0, Math.min(baseAmount - discountAmount, amountOff));
    discountAmount += appliedAmount;
    return {
      type: discount.type || "manual",
      code: discount.code || "",
      label: discount.label || "Discount",
      percentOff: discount.percentOff || 0,
      amountOff: discount.amountOff || 0,
      appliedAmount,
    };
  });
  return { totalAmount: Math.max(0, baseAmount - discountAmount), discountAmount, discounts: normalized };
}

function splitAmount(totalAmount, count) {
  const base = Math.floor(totalAmount / count);
  const remainder = totalAmount - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function buildInstallmentSchedule(totalAmount, planKey = "pay_in_full", startDate = new Date()) {
  const count = planKey === "four_installments" ? 4 : planKey === "two_installments" ? 2 : 1;
  return splitAmount(totalAmount, count).map((amount, index) => ({
    installment: index + 1,
    sequence: index + 1,
    amount,
    dueDate: new Date(startDate.getTime() + index * 30 * 24 * 60 * 60 * 1000),
    status: index === 0 ? "pending" : "scheduled",
  }));
}

function calculateTax({ subtotal, taxRate = 0 }) {
  return Math.max(0, Math.round(Number(subtotal || 0) * Number(taxRate || 0)));
}

module.exports = {
  DEFAULT_CURRENCY,
  PRICING_VERSION,
  applyDiscounts,
  buildInstallmentSchedule,
  calculateTax,
  normalizeTier,
  resolveBasePrice,
};
