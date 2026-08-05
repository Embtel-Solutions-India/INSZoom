/**
 * Visa categories, types, and short descriptions (goal-4 spec).
 * VISA_DETAILS powers the per-category info popup; VISA_TYPES is the flat
 * id list kept for backward compatibility (Dashboard, Profile wizard).
 */
export const VISA_CATEGORIES = [
  { id: "Work",       label: "Work",                 desc: "Employment-based U.S. visas." },
  { id: "Family",     label: "Family",               desc: "Family-sponsored and dependent visas." },
  { id: "Student",    label: "Student",              desc: "Study and exchange visitor visas." },
  { id: "Temporary",  label: "Temporary",            desc: "Visitor and short-term stay visas." },
  { id: "Business",   label: "Business",             desc: "Business, investor, and treaty visas." },
  { id: "Green Card", label: "Permanent / Green Card", desc: "Permanent residence (green card) categories." },
];

// Visa types per category with very short descriptions (used in the info popup).
export const VISA_DETAILS = {
  Work: [
    { id: "H-1B", desc: "Specialty occupation jobs requiring a degree." },
    { id: "L-1",  desc: "Transfer from a foreign company to a U.S. office." },
    { id: "O-1",  desc: "Extraordinary ability in business, arts, science, education, or athletics." },
    { id: "TN",   desc: "Canadian/Mexican professionals under USMCA." },
    { id: "E-2",  desc: "Treaty investor operating a U.S. business." },
  ],
  Family: [
    { id: "IR-1/CR-1", desc: "Spouse green card for a U.S. citizen's spouse." },
    { id: "K-1",       desc: "Fiancé(e) visa to marry a U.S. citizen." },
    { id: "F2A",       desc: "Spouse/minor child of a green card holder." },
    { id: "F2B",       desc: "Unmarried adult child of a green card holder." },
  ],
  Student: [
    { id: "F-1", desc: "Academic student visa." },
    { id: "J-1", desc: "Exchange visitor / research / training visa." },
    { id: "M-1", desc: "Vocational student visa." },
  ],
  Temporary: [
    { id: "B-1/B-2", desc: "Business/tourism visitor visa." },
    { id: "ESTA",    desc: "Visa waiver travel authorization." },
    { id: "H-2B",    desc: "Temporary non-agricultural work visa." },
  ],
  Business: [
    { id: "E-1",  desc: "Treaty trader visa." },
    { id: "E-2",  desc: "Treaty investor visa." },
    { id: "L-1",  desc: "Company transfer / business expansion." },
    { id: "EB-5", desc: "Investor green card." },
  ],
  "Green Card": [
    { id: "EB-1",     desc: "Extraordinary ability / outstanding professional green card." },
    { id: "EB-2 NIW", desc: "National Interest Waiver green card." },
    { id: "EB-3",     desc: "Skilled / professional worker green card." },
    { id: "EB-5",     desc: "Investment-based green card." },
  ],
};

// Flat id lists per category (backward-compatible with existing consumers).
export const VISA_TYPES = Object.fromEntries(
  Object.entries(VISA_DETAILS).map(([cat, list]) => [cat, list.map((v) => v.id)])
);

/** Find the category id that contains a given visa type id (or "" if none). */
export function getCategoryByVisa(visaType) {
  const entry = Object.entries(VISA_DETAILS).find(([, list]) => list.some((v) => v.id === visaType));
  return entry ? entry[0] : "";
}

// Map a visa type to a likely intake 'purpose' to prefill the quiz when possible.
export const VISA_PURPOSE_MAP = {
  "H-1B": "work",
  "L-1": "work",
  "O-1": "work",
  "TN": "work",
  "E-3": "work",
  "E-2": "invest",
  "E-1": "business_visit",
  "B-1": "business_visit",
  "B-1/B-2": "visit",
  "B-2": "visit",
  "ESTA": "visit",
  "H-2B": "work",
  "F-1": "study",
  "F-1 CPT/OPT": "study",
  "J-1": "study",
  "M-1": "study",
  "K-1": "family",
  "K-3": "family",
  "IR-1/CR-1": "family",
  "F2A": "family",
  "F2B": "family",
  "H-4": "family",
  "EB-1": "permanent",
  "EB-1A": "permanent",
  "EB-2": "permanent",
  "EB-2 NIW": "permanent",
  "EB-3": "permanent",
  "EB-5": "invest",
};
