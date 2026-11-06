// Authored field rules for the two DOL forms the pipeline fetches from dol.gov (uscis-form-import/config/externalForms.js):
//   ETA-9089A   Form ETA-9089, Appendix A           (Foreign Worker Information)
//   ETA-9089FD  Form ETA-9089, Final Determination
// Every stem is the REAL last PDF-name segment of a box in the official file (read from the 2026-11 DOL PDFs; the doubled spaces are DOL's own), never a label guess, and every canonical path
// below is one the other forms' rules already use. Same decision as the I-9: EXCLUSIVE (see partyFieldRules.js) - only these rule-backed edges exist, so no auto-guessed value can reach a box
// no rule covers.
//
// Deliberately NOT mapped (left blank for the case manager / the form itself):
//   - boxes DOL fills in itself: DOL case number, case status, filing / determination / expiration dates, the DOL electronic signature;
//   - every signature / date-signed / middle-initial box and the attorney-or-agent and employer-signatory blocks (they describe other people);
//   - Appendix A's education, training and employment-history blocks (repeating records whose canonical item shape no other form maps yet) and the "Province" box (no verified canonical path).
// A box left unmapped stays blank and editable; the pipeline activates the mapping without it (owner decision 2026-10-23) and reports how many boxes were left.
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });
const COUNTRY = { transform: { type: "country" } };

// ---- Appendix A: the foreign worker (beneficiary.*) ----
const ETA9089A_RULES = [
  R("beneficiary.lastName", "1  Foreign Workers Last family Name"),
  R("beneficiary.firstName", "2  Foreign Workers First given Name"),
  R("beneficiary.middleName", "3  Foreign Workers Middle Names"),
  R("beneficiary.address", "4  Address 1 current"),
  R("beneficiary.apartment", "5  Address 2 apartmentsuitefloor and number"),
  R("beneficiary.city", "6  City"),
  R("beneficiary.state", "7  State"),
  R("beneficiary.zipCode", "8  Postal Code"),
  R("beneficiary.dateOfBirth", "11  Date of Birth mmddyyyy"),
  R("beneficiary.currentVisaStatus", "12  Class of Admission"),
  R("beneficiary.alienRegistrationNumber", "13  Alien Registration Number A if applicable", { transform: { type: "alienNumber" } }),
  R("beneficiary.countryOfBirth", "14  Country of Birth", COUNTRY),
  R("beneficiary.countryOfCitizenship", "15  Country of Citizenship or Nationality", COUNTRY),
];

// ---- Final Determination page 1: the employer (petitioner.*), the foreign worker (beneficiary.*) and the job ----
const ETA9089FD_RULES = [
  R("petitioner.name", "3  Employer Legal Business Name"),
  R("petitioner.ein", "4  Employer FEIN"),
  R("beneficiary.lastName", "5  Foreign Workers Last family Name"),
  R("beneficiary.firstName", "6  Foreign Workers First given Name"),
  R("beneficiary.middleName", "7  Foreign Workers Middle Names"),
  R("petitioner.jobTitle", "8  Job Title"),
  R("petitioner.job.socCode", "9  SOC Code"),
];

module.exports = { ETA9089A_RULES, ETA9089FD_RULES };
