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
  "I-864A": { identity: { party: "beneficiary" } },
  "I-130A": { identity: { party: "beneficiary" } },
  "I-485A": { identity: { party: "beneficiary" } },
  "I-918SUPA": { identity: { party: "beneficiary" } },
  "I-918 SUPPLEMENT A": { identity: { party: "beneficiary" } },
  "I-918": { identity: { party: "beneficiary", fallbackParty: "petitioner" } },
};

// Forms that have nothing for a case to fill (a fee schedule, a form with no fields a case holds): they are released on certification alone, with no mapping.
const NO_MAPPING_FORMS = new Set(["G-1055", "G-1651"]);

module.exports = { PARTY_FORM_SPECS, NO_MAPPING_FORMS };
