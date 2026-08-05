// Display metadata for the eligibility quiz's category picker step. `id`
// must match the `category` field the backend tags each visa with (see
// Backend/src/modules/eligibility-quiz/quiz.config.js VISA_PATHWAYS) — the
// example-visa subtext under each card is derived live from the fetched
// visa list (grouped by category), not hardcoded here, so the two can never
// drift out of sync.
export const ELIGIBILITY_CATEGORIES = [
  {
    id: "work",
    label: "Work / Employment",
    description: "Employer-sponsored nonimmigrant work visas.",
  },
  {
    id: "family",
    label: "Family-Based",
    description: "Visas for spouses, fiancé(e)s, and family members.",
  },
  {
    id: "green_card",
    label: "Green Card (Employment-Based)",
    description: "Employment-based permanent residence categories.",
  },
  {
    id: "investor",
    label: "Investor",
    description: "Visas based on a qualifying business investment.",
  },
  {
    id: "extraordinary_ability",
    label: "Extraordinary Ability / Talent",
    description: "For those with sustained national or international acclaim.",
  },
  {
    id: "temporary",
    label: "Temporary / Visitor",
    description: "Short-term visits, study, and exchange programs.",
  },
];
