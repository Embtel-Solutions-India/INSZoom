// Which party each part of a form belongs to - the one decision a person makes; PartRuleInferenceService / FieldRuleInferenceService do the rest by code.
// Decided by the product owner (2026-10-27/28). Roots: petitioner.* = the sponsor / the person filing; beneficiary.* = the person the filing is for (see docs/GENERIC_PARTY_CANONICAL_MODEL.md).
//
//   groups   - parts of the form that belong to a party. Within a group only the first occurrence of each fact (name, date of birth, address, ...) in reading order is mapped.
//   identity - the form is entirely about one person: the filer's identity block (Part 1 "Information About You") is mapped to that party. fallbackParty: when that party's value is
//              blank the other party's is used (I-918: a single-person case holds the victim under petitioner.*, a family case under beneficiary.*; beneficiary.* is filled from person.*
//              for every case, so it leads).
// A form listed here is mapped even when the registry says it serves petition / family cases (the case-structure gate only protects forms nobody has decided).
const PARTY_FORM_SPECS = {
  // I-212: Parts 1-4 petitioner, Part 5 deliberately left blank (nothing mapped), Part 6 beneficiary
  "I-212": { groups: [{ party: "petitioner", parts: [1, 2, 3, 4] }, { party: "beneficiary", parts: [6] }] },
  "I-601": { groups: [{ party: "petitioner", parts: [1, 2, 3, 4] }, { party: "beneficiary", parts: [7] }] },
  "I-800": { groups: [{ party: "petitioner", parts: [1, 2, 3] }, { party: "beneficiary", parts: [4] }] },
  "I-800A": { groups: [{ party: "petitioner", parts: [1, 2] }, { party: "beneficiary", parts: [3] }] },
  // I-821D: ONLY Part 1 is filled, from the petitioner; nothing else is mapped (owner decision 2026-10-28, replacing "Parts 1-4 petitioner, Part 5 beneficiary")
  "I-821D": { groups: [{ party: "petitioner", parts: [1] }] },
  // I-134 (Declaration of Financial Support): Parts 2 and 5 are the individual agreeing to support the beneficiary - the JOINT SPONSOR. Family cases send that checklist to the petitioner, so it
  // reads petitioner.jointSponsor.*; in an employer-employee case the employee (the beneficiary) fills it in, so it falls back to beneficiary.jointSponsor.*. Parts 3-4 are the beneficiary.
  // Part 1 (basis for filing, check boxes only) and Parts 6-8 (interpreter, preparer, additional information) are left blank.
  "I-134": { groups: [{ party: "petitioner", root: "petitioner.jointSponsor", fallbackRoot: "beneficiary.jointSponsor", parts: [2, 5] }, { party: "beneficiary", parts: [3, 4] }] },
  // I-140: Parts 1, 2, 5 and 8 are the petitioner; Parts 3 and 4 the beneficiary. Part 6 (the job) and Parts 9-11 (interpreter, preparer, additional information) are left blank. Part 7 (the beneficiary's
  // spouse and children) is left blank for now: its checklist question (employee_i140SpouseChildren) is a repeating group with no row fields defined, so there is nothing reliable to map -
  // add the row fields to the checklist, then add Part 7 as a beneficiary group here. These rules ADD to the form's authored I140_RULES (partyFieldRules.js); they never replace them.
  "I-140": { groups: [{ party: "petitioner", parts: [1, 2, 5, 8] }, { party: "beneficiary", parts: [3, 4] }] },
  // I-129 and its supplements (owner decisions 2026-10-28). MAIN (the "Part N." headings): Parts 1-2 petitioner, 3-4 beneficiary, 5 (the employer's address) and 7 (declaration) petitioner;
  // Part 8 (preparer) blank; Parts 6 and 9 not assigned, so blank. SUPPLEMENTS (slices of the same PDF, "Section N." headings inside each page range): every supplement's header gives the
  // petitioner's name (Item 1) and the beneficiary's name (Item 2) - SUPPLEMENT_HEADER_GROUPS - and then:
  //   E        Sections 1-2 petitioner; 3-4 blank            Trade Agreement  Section 2 petitioner; 3 blank (1 not assigned)
  //   H        Sections 1-2 petitioner; 3 blank              H-1B Data Collection  Section 1 and 3 the beneficiary (item 1 / the petitioner is its header); 2 and 4 blank
  //   L        Section 1 both (authored rules, i129SupplementRules.js); 2-3 blank
  //   O/P      Sections 1-2 petitioner                       Q  Section 1 petitioner         R  Section 1 petitioner (2 not assigned)
  // The Additional Beneficiary component is not assigned. A block that belongs to somebody else (the H-2 recruiter, a joint employer, an employer abroad, an authorised signatory) is never
  // mapped to the petitioner whatever the section was given to (PartRuleInferenceService). The authored I-129 rules in partyFieldRules.js stay; these ADD to them.
  "I-129": {
    groups: [{ party: "petitioner", parts: [1, 2, 5, 7] }, { party: "beneficiary", parts: [3, 4] }],
    components: {
      "I129_E_": { groups: [{ party: "petitioner", parts: [1, 2] }] },
      "I129_TRADE_": { groups: [{ party: "petitioner", parts: [2] }] },
      // H Section 2 is left out on purpose: its only identity-like boxes are the H-2 recruiter (Item 7), the joint employer (Items 24-26) and the authorised signatory (Item 27) - none of them
      // the petitioner, so mapping "Section 2 = petitioner" would put a stranger's name, EIN and SSN on the form.
      "I129_H_CLASSIFICATION": { groups: [{ party: "petitioner", parts: [1] }] },
      "I129_H_1B_": { groups: [{ party: "beneficiary", parts: [1, 3], facts: ["lastName", "firstName", "middleName", "dateOfBirth", "aNumber", "ssn", "countryOfBirth", "countryOfCitizenship"] }] },
      "I129_L_": { groups: [] },
      "I129_O_P_": { groups: [{ party: "petitioner", parts: [1, 2] }] },
      "I129_Q_": { groups: [{ party: "petitioner", parts: [1] }] },
      "I129_R_": { groups: [{ party: "petitioner", parts: [1] }] },
    },
  },
  "I-864A": { identity: { party: "beneficiary" } },
  "I-130A": { identity: { party: "beneficiary" } },
  "I-485A": { identity: { party: "beneficiary" } },
  "I-918SUPA": { identity: { party: "beneficiary" } },
  "I-918 SUPPLEMENT A": { identity: { party: "beneficiary" } },
  "I-918": { identity: { party: "beneficiary", fallbackParty: "petitioner" } },
};

// Forms that have nothing for a case to fill (a fee schedule, a form with no fields a case holds): they are released on certification alone, with no mapping.
const NO_MAPPING_FORMS = new Set(["G-1055", "G-1651"]);

// The header every supplement of a form made of slices starts with: Item 1 the petitioner's name, Item 2 the beneficiary's name (Section 0 = above the supplement's first "Section" heading).
// Names only - the header also holds boxes that are neither (the treaty country of an E supplement).
const SUPPLEMENT_HEADER_GROUPS = Object.freeze([
  Object.freeze({ party: "petitioner", parts: [0], facts: ["name"] }),
  Object.freeze({ party: "beneficiary", parts: [0], facts: ["fullName", "lastName", "firstName", "middleName"] }),
]);

module.exports = { PARTY_FORM_SPECS, NO_MAPPING_FORMS, SUPPLEMENT_HEADER_GROUPS };
