// Canonical visa-type keys used to look up document requirements, questionnaire
// templates, etc. Visa type is captured/stored elsewhere in the app under a mix
// of spellings ("L-1A", "l1a", "L1A", "H-1B", ...) — this module does NOT change
// any of that; it only gives every lookup a single normalized key to compare
// against, replacing the private ad hoc normalizers previously duplicated in
// documentRequirements.js and questionnaire.service.js.

const VISA_TYPES = {
  F1: "F1",
  H1B: "H1B",
  L1A: "L1A",
  L1B: "L1B",
  O1: "O1",
  P: "P",
  EB1A: "EB1A",
  EB2_NIW: "EB2_NIW",
  B1: "B1",
  B2: "B2",
  B1B2: "B1B2",
  E1: "E1",
  E2: "E2",
  E3: "E3",
  TN: "TN",
  H2B: "H2B",
  ESTA: "ESTA",
  J1: "J1",
  M1: "M1",
  K1: "K1",
  K3: "K3",
  IR1CR1: "IR1CR1",
  F2A: "F2A",
  F2B: "F2B",
  H4: "H4",
  EB1: "EB1",
  EB2: "EB2",
  EB3: "EB3",
  EB5: "EB5",
  N400: "N400",
  I130: "I130",
  I485: "I485",
};

// Spellings that don't reduce cleanly via normalizeVisaType()'s strip+uppercase
// pass (ambiguous shorthand the strip can't disambiguate on its own).
const LEGACY_ALIASES = {
  "L1": "L1A", // the manual visa-type selector only ever offers bare "L-1" today — treat it as L-1A, the far more common filing
  "EB2NIW": "EB2_NIW",
};

// The exact string keys used inside Backend/src/config/visaChecklists.js's
// VISA_CHECKLISTS table, keyed by canonical type, so that table's own keys
// never need to change.
const LEGACY_LABEL_FOR_CHECKLIST = {
  F1: "F-1",
  H1B: "H-1B",
  O1: "O-1",
  EB1A: "EB-1A",
  EB2_NIW: "EB-2 NIW",
  B1: "B-1",
  B2: "B-2",
  B1B2: "B-1/B-2",
  L1A: "L-1",
  L1B: "L-1",
  E1: "E-1",
  E2: "E-2",
  E3: "E-3",
  TN: "TN",
  H2B: "H-2B",
  ESTA: "ESTA",
  J1: "J-1",
  M1: "M-1",
  K1: "K-1",
  K3: "K-3",
  IR1CR1: "IR-1/CR-1",
  F2A: "F2A",
  F2B: "F2B",
  H4: "H-4",
  EB1: "EB-1",
  EB2: "EB-2",
  EB3: "EB-3",
  EB5: "EB-5",
};

function normalizeVisaType(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const stripped = raw.replace(/[\s_\-/]+/g, "").toUpperCase();
  if (VISA_TYPES[stripped]) return stripped;
  if (LEGACY_ALIASES[stripped]) return LEGACY_ALIASES[stripped];
  return null;
}

module.exports = {
  VISA_TYPES,
  LEGACY_LABEL_FOR_CHECKLIST,
  normalizeVisaType,
};
