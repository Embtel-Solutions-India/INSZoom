/**
 * BAIS Internal Visa Fee Schedule
 * ─────────────────────────────────────────────────────────────────────────────
 * Source: staff fee reference sheet (Excel, updated manually).
 * All dollar amounts are stored as integers (USD cents).
 * uscisNotes: human-readable string for conditional USCIS fee tiers.
 * baisFee: BAIS service fee in cents (null when it varies - see baisNotes).
 * uscisBaseFee: base USCIS filing fee in cents (null = see uscisNotes; 0 = no fee).
 * processingTimeBefore: processing time before COVID as a string, or null.
 *
 * This file is the single source of truth for internal fee display in
 * INSZoom (served via GET /api/fee-schedule). It is NOT the client-facing
 * package pricing - that lives in BAIS/Frontend/src/config/pricingCatalog.js
 * and must not be touched from here.
 */

const FEE_SCHEDULE = [
  {
    id: "upgrade_premium",
    label: "Upgrade to Premium Processing",
    explanation: "Petitioner sends I-907 with PPS check. On I-907, provide USCIS file number (if known) and attach I-797 receipt copy.",
    baisFee: 35000, // $350
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: "I-129 / I-140: $2,805 | I-539: $1,965 | I-765, H-2B, R: $1,685",
    processingTimeBefore: "I-129: 14 days | I-140: 45 days | I-539: 30 days | I-765: 30 days",
  },
  {
    id: "h1b_new",
    label: "New H-1B",
    explanation: "New employer must petition for the new H-1B by filing an I-129.",
    baisFee: 175000, // $1,750
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: "≤25 employees: $2,010 | >25 employees: $3,380 paper / $3,330 online | >50 employees AND ≥50% in H-1B/L-1A/L-1B: $7,880 paper / $7,330 online",
    processingTimeBefore: null,
  },
  {
    id: "h1b_transfer",
    label: "H-1B Transfer",
    explanation: "I-751",
    baisFee: 175000,
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: "≤25 employees: $2,010 | >25 employees: $3,380 paper / $3,330 online | >50 employees AND ≥50% in H-1B/L-1A/L-1B: $7,880 paper / $7,330 online",
    processingTimeBefore: null,
  },
  {
    id: "h1b_amendment",
    label: "H-1B Amendment",
    explanation: "Employer files I-129 to notify USCIS of a material change in H-1B employment.",
    baisFee: 175000,
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: "≤25 employees: $760 ($460+$300) | >25 employees: $1,380 paper ($780+$600) / $1,330 online ($730+$600)",
    processingTimeBefore: null,
  },
  {
    id: "h1b_first_extension",
    label: "H-1B First Extension",
    explanation: null,
    baisFee: 175000,
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: "≤25 employees: $1,510 ($460+$750+$300) | >25 employees: $2,880 paper ($780+$600+$1,500) / $2,830 online ($730+$600+$1,500)",
    processingTimeBefore: null,
  },
  {
    id: "h1b_second_ext_and_up",
    label: "H-1B Second Extension and Up",
    explanation: null,
    baisFee: 175000,
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: "≤25 employees: $760 ($460+$300) | >25 employees: $1,380 paper ($780+$600) / $1,330 online ($730+$600)",
    processingTimeBefore: null,
  },
  {
    id: "h1b_amendment_ext",
    label: "H-1B Amendment EXT",
    explanation: null,
    baisFee: 175000,
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: "≤25 employees: $1,510 ($460+$750+$300) | >25 employees: $2,880 paper ($780+$600+$1,500) / $2,830 online ($730+$600+$1,500)",
    processingTimeBefore: null,
  },
  {
    id: "h1b_concurrent",
    label: "H-1B Concurrent",
    explanation: null,
    baisFee: 175000,
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: "≤25 employees: $2,010 | >25 employees: $3,380 paper / $3,330 online | >50 employees AND ≥50% in H-1B/L-1A/L-1B: $7,880 paper / $7,330 online",
    processingTimeBefore: null,
  },
  {
    id: "l1b_new",
    label: "L-1B Application New (5 yrs)",
    explanation: null,
    baisFee: 175000,
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: null,
    processingTimeBefore: null,
  },
  {
    id: "l1a_company_setup",
    label: "L-1A Company Set-up",
    explanation: null,
    baisFee: 250000, // $2,500
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: null,
    processingTimeBefore: null,
  },
  {
    id: "l1a_petition",
    label: "L-1A Petition",
    explanation: null,
    baisFee: 450000, // $4,500
    baisNotes: null,
    uscisBaseFee: 149500, // $1,495
    uscisNotes: null,
    processingTimeBefore: null,
  },
  {
    id: "l1a_business_plan",
    label: "L-1A Business Plan",
    explanation: null,
    baisFee: 250000, // $2,500
    baisNotes: null,
    uscisBaseFee: null,
    uscisNotes: null,
    processingTimeBefore: null,
  },
  {
    id: "k1_visa",
    label: "Fiancée Visa K-1 (if not married, 90 days)",
    explanation: "Visa issued to the fiancé of a US citizen to enter the US.",
    baisFee: null, // varies - see baisNotes
    baisNotes: "Ranging $4,000–$4,500",
    uscisBaseFee: 53500, // $535
    uscisNotes: null,
    processingTimeBefore: null,
  },
  {
    id: "k3_visa",
    label: "Fiancée Visa K-3 (if married)",
    explanation: "Allows spouse of US citizen to enter; wait till Green Card.",
    baisFee: 175000, // $1,750
    baisNotes: null,
    uscisBaseFee: 0, // no USCIS fee
    uscisNotes: "No USCIS Fee",
    processingTimeBefore: null,
  },
];

module.exports = { FEE_SCHEDULE };
