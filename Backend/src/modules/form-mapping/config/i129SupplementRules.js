// Form I-129 supplement boxes whose meaning is NOT a plain petitioner / beneficiary identity fact, authored from the real PDF (page-restricted: the same box names repeat on other
// pages of the I-129). Added to the form's own authored rules in partyFieldRules.js. Owner decisions 2026-10-28.
//
// L Classification Supplement (pages 24-27), Section 1 - "both the petitioner and the beneficiary":
//   Item 2  table "Subject's Name | From | To": row 1 is the beneficiary and the dates of their qualifying employment abroad (the L-1A checklist's
//           beneficiary.foreignEmployment.startDate / endDate); the further rows are other people and stay blank.
//   Item 3  the qualifying employer ABROAD: it is a fact about the petitioner (the L-1A checklist's petitioner.foreignCompany.*).
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });
const FULL_NAME = { type: "concat", fields: ["beneficiary.firstName", "beneficiary.middleName", "beneficiary.lastName"], separator: " " };
const L_SECTION_1 = { pages: [24] };

const I129_SUPPLEMENT_RULES = [
  R("beneficiary.fullName", "Sect1_Name_Line1", { ...L_SECTION_1, transform: FULL_NAME }),
  R("beneficiary.foreignEmployment.startDate", "DateFrom_line1", L_SECTION_1),
  R("beneficiary.foreignEmployment.endDate", "DateTo_line1", L_SECTION_1),
  R("petitioner.foreignCompany.name", "LSuppLine3_NameofEmployerAbroad", L_SECTION_1),
  R("petitioner.foreignCompany.address.line1", "Part3Line2_StreetName", L_SECTION_1),
  R("petitioner.foreignCompany.address.line2", "Line2_AptSteFlrNumber", L_SECTION_1),
  R("petitioner.foreignCompany.address.city", "Part3Line2_City", L_SECTION_1),
  R("petitioner.foreignCompany.address.state", "Part3Line2_Province", L_SECTION_1),
  R("petitioner.foreignCompany.address.zip", "Part3Line2_ZipCode", L_SECTION_1),
  R("petitioner.foreignCompany.address.postalCode", "Part3Line2_PostalCode", L_SECTION_1),
  R("petitioner.foreignCompany.address.country", "Part3Line2_Country", { ...L_SECTION_1, transform: { type: "country" } }),
];

module.exports = { I129_SUPPLEMENT_RULES };
