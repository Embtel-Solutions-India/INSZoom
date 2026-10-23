// Form I-131 (Application for Travel Document), edition 01/20/25 - the same edition USCIS publishes today (page checked 2026-10-22: Edition Date 01/20/25; the
// official PDF's sha256 equals the stored template's, so there is nothing newer to import). The applicant is the checklist's client, stored under petitioner.*.
//
// Not exclusive: the 77 edges the form already has (name, A-Number, addresses, the I-131 checklist's travel / refugee / re-entry answers) are kept exactly as they
// are; these rules only ADD the boxes that had no canonical path, each wired to a generic path another checklist already writes (the green-card-renewal checklist's
// physical-description answers, the USCIS online account, the I-94 number, the applicant's own phone / e-mail). Stems are exact PDF field names (case-insensitive,
// without "[n]"); an index restriction separates the boxes of one name.
//
// Left to the case manager, on purpose (nothing collects it, or it is a judgement a generic fact cannot make): every eligibility-category box of Part 1 (Items 1-11,
// receipt numbers, the military / parole programme boxes), other names used (Part 2 Item 2 - a free-text answer, three structured rows on the form), the mailing and
// physical address detail boxes of Part 2 (in care of, Apt / Ste / Flr, province - the existing address edges read the profile address, a second source would mix two
// addresses in one block), the I-94 expiry date, Part 4 and Part 5 Yes / No and time-outside-the-US boxes the I-131 checklist does not word one-to-one, Parts 8 and 9,
// the interpreter and the preparer (never filled), signatures and the additional-information pages.
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });
const CASE = { ignoreCase: true };
const TEXT = { transform: { type: "string" } };
const DIGITS = { transform: { type: "digits" } };
const PHONE = { transform: { type: "phone" } };

// the order of the check boxes inside each group, read from the labels of the active template (they are NOT alphabetical)
const EYE = ["Brown", "Gray", "Maroon", "Unknown / Other", "Pink", "Hazel", "Green", "Blue", "Black"];
const HAIR = ["Bald (No hair)", "Blond", "Gray", "Sandy", "Unknown / Other", "White", "Red", "Brown", "Black"];
const RACE = [["White", "white"], ["Asian", "asian"], ["Black", "black_or_african_american"], ["American", "american_indian_or_alaska_native"], ["Hawaiian", "native_hawaiian_or_other_pacific_islander"]];

const I131_RULES = [
  // ---- Part 2: about you ----
  R("petitioner.uscisOnlineAccountNumber", "Part2_Line11_USCISOnlineAcctNumber", DIGITS),
  R("petitioner.i94Number", ["Part2_Line13_I94RecordNo", "P2_Line27_I94RecordNo"]),

  // ---- Part 3: biographic information ----
  R("petitioner.ethnicity", "P3_Line1_Ethnicity", { index: 0, checkboxEquals: "not_hispanic_or_latino", ...CASE }),
  R("petitioner.ethnicity", "P3_Line1_Ethnicity", { index: 1, checkboxEquals: "hispanic_or_latino", ...CASE }),
  ...RACE.map(([box, value]) => R("petitioner.race", `P3_Line2_Race_${box}`, { checkboxEquals: value, ...CASE })),
  R("petitioner.heightFeet", "P3_Line3_HeightFeet", TEXT),
  R("petitioner.heightInches", "P3_Line3_HeightInches", TEXT),
  // weight: three one-digit boxes, zero-padded on the left
  R("petitioner.weightPounds", "P3_Line4_Pound1", { transform: { type: "digitAt", pad: 3, index: 0 } }),
  R("petitioner.weightPounds", "P3_Line4_Pound2", { transform: { type: "digitAt", pad: 3, index: 1 } }),
  R("petitioner.weightPounds", "P3_Line4_Pound3", { transform: { type: "digitAt", pad: 3, index: 2 } }),
  ...EYE.map((color, index) => R("petitioner.eyeColor", "P3_Line5_EyeColor", { index, checkboxEquals: color, ...CASE })),
  ...HAIR.map((color, index) => R("petitioner.hairColor", "P3_Line6_HairColor", { index, checkboxEquals: color, ...CASE })),

  // ---- Part 10: the applicant's statement (contact details) ----
  // the contract reads "Applicant's ..." as the person the form is for (beneficiary.*); on this single-party form the checklist stores that person as petitioner.*,
  // so the generic petitioner path is the fallback (the same pairing the N-400 uses for its applicant's statement)
  R("beneficiary.primaryPhone", "Part10_Line1_DayPhone", { ...PHONE, fallback: "petitioner.phone" }),
  R("beneficiary.mobilePhone", "Part10_Line2_MobilePhone", { ...PHONE, fallback: "petitioner.mobilePhone" }),
  R("beneficiary.email", "Part10_Line3_Email", { fallback: "petitioner.email" }),
];

module.exports = { I131_RULES };
