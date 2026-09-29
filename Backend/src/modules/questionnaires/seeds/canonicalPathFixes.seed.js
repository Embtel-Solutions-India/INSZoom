// Phase 2 (Checklist <-> Canonical <-> USCIS PDF traceability) canonical-path
// fixes discovered by re-tracing the Phase 1 zero-coverage forms (I-130,
// I-539A/cos_f1/cos_f2/h4_extension_ead) against their REAL PDF mapping
// graph edges, not just added blindly to raise a percentage. See
// docs/forms/ (Phase 2 report) for the full investigation. Three distinct,
// independently-verified fixes:
//
// 1. I-130's petitioner/beneficiary checklists (both the k3_* key style and
//    the identical-across-12-visa-categories i130_<code>_* key style) never
//    had ANY canonicalPath - Question.mapping.canonicalPath is set here so
//    checklist answers reach Case.canonicalProfile.profile.person.*/
//    beneficiary.* the same way every other form's checklist answers do.
//    (I-130's PDF mapping graph itself is converted from
//    raw.questionnaireAnswers.<one-key-style-only> binding to these same
//    canonical paths separately, in MappingGraphService - see
//    scripts/fix-i130-mapping-graph.js.)
// 2. h4_extension_questionnaire/h4_extension_ead_questionnaire/
//    cos_f1_questionnaire/cos_f2_questionnaire already had canonicalPath
//    set, but under a self-invented "applicant.*" namespace that the real
//    canonical profile/PDF mapping graph never uses (verified: I-539/
//    I-539A's real mapping edges use person.*/contact.*/immigration.*).
//    Renamed field-by-field to the real namespace; two fields
//    (usPhysicalAddress on 4 questionnaires) have their canonicalPath
//    UNSET rather than guessed, because no distinct "physical, if
//    different from mailing" canonical field exists (contact.address.line1
//    is already claimed by the physical-address mapping below, and
//    inventing a second slot would conflate two different pieces of
//    information - a genuine schema gap, reported, not papered over).
//
// Every mapping below was checked against a real PDF mapping graph edge
// (either an existing one, or, for I-130, the ones this phase adds) or
// against an established CanonicalFieldRegistryService.BASE_FIELDS path -
// never invented ad hoc.
const mongoose = require("mongoose");
const Questionnaire = require("../../../models/Questionnaire");
const Question = require("../../../models/Question");

// --- Fix 1: I-130 petitioner/beneficiary checklists ---

// K3-style key -> canonical path. Used by k3_petitioner_checklist /
// k3_beneficiary_checklist only (I-129F's k1_petitioner_checklist /
// k1_beneficiary_checklist are a SEPARATE, byte-identical-looking but
// distinct questionnaire and are deliberately left untouched - I-129F's
// mapping already works via raw.questionnaireAnswers.* and must not be
// touched just to raise a traceability percentage).
const K3_PETITIONER_MAP = {
  petitioner_info_lastName: "person.lastName",
  petitioner_info_firstName: "person.firstName",
  petitioner_info_middleName: "person.middleName",
  petitioner_info_dateOfBirth: "person.dob",
  petitioner_info_gender: "person.gender",
  petitioner_info_maritalStatus: "person.maritalStatus",
  petitioner_info_ssn: "person.ssn",
  petitioner_info_aNumber: "person.alienNumber",
  petitioner_info_cityTownOfBirth: "person.cityTownOfBirth",
  petitioner_info_countryOfBirth: "person.countryOfBirth",
  petitioner_info_countryOfCitizenship: "person.citizenship",
  petitioner_info_uscisOnlineAccountNumber: "person.uscisOnlineAccountNumber",
  petitioner_citizenship_certificateNumber: "person.certificateNumber",
  petitioner_citizenship_certificateDateOfIssuance: "person.certificateDateOfIssuance",
  petitioner_citizenship_certificatePlaceOfIssuance: "person.certificatePlaceOfIssuance",
  petitioner_info_fullPhysicalAddress: "contact.address.line1",
  // fullMailingAddress intentionally left unmapped - see file header.
};

const K3_BENEFICIARY_MAP = {
  beneficiary_info_lastName: "beneficiary.lastName",
  beneficiary_info_firstName: "beneficiary.firstName",
  beneficiary_info_middleName: "beneficiary.middleName",
  beneficiary_info_dateOfBirth: "beneficiary.dateOfBirth",
  beneficiary_info_gender: "beneficiary.gender",
  beneficiary_info_maritalStatus: "beneficiary.maritalStatus",
  beneficiary_info_aNumber: "beneficiary.alienRegistrationNumber",
  beneficiary_info_cityTownOfBirth: "beneficiary.cityTownOfBirth",
  beneficiary_info_countryOfBirth: "beneficiary.countryOfBirth",
  beneficiary_info_countryOfCitizenship: "beneficiary.countryOfCitizenship",
  beneficiary_info_fullPhysicalAddress: "beneficiary.address",
  // beneficiary_info_ssn intentionally left unmapped - no full-SSN
  // canonical field exists (policy: never fill a PDF SSN field from a
  // masked/partial value, and this is a full 9-digit field).
  // fullMailingAddress intentionally left unmapped - see file header.
};

// IR/CR/F-style key (identical question-key set across all 12 i130_<code>_
// petitioner/beneficiary_checklist questionnaires) -> canonical path.
const IR_PETITIONER_MAP = {
  petitioner_lastName: "person.lastName",
  petitioner_firstName: "person.firstName",
  petitioner_middleName: "person.middleName",
  petitioner_dateOfBirth: "person.dob",
  petitioner_gender: "person.gender",
  petitioner_maritalStatus: "person.maritalStatus",
  petitioner_ssn: "person.ssn",
  petitioner_alienNumber: "person.alienNumber",
  petitioner_naturalizationCertificateNumber: "person.certificateNumber",
  petitioner_physicalAddress: "contact.address.line1",
  // cityCountryOfBirth/naturalizationDateAndPlace intentionally left
  // unmapped - each combines two distinct concepts (city+country,
  // date+place) into one free-text answer that cannot be split into the
  // separate canonical fields the PDF actually needs without guessing.
  // mailingAddress intentionally left unmapped - see file header.
};

const IR_BENEFICIARY_MAP = {
  beneficiary_lastName: "beneficiary.lastName",
  beneficiary_firstName: "beneficiary.firstName",
  beneficiary_middleName: "beneficiary.middleName",
  beneficiary_dateOfBirth: "beneficiary.dateOfBirth",
  beneficiary_maritalStatus: "beneficiary.maritalStatus",
  beneficiary_alienNumber: "beneficiary.alienRegistrationNumber",
  beneficiary_physicalAddress: "beneficiary.address",
  beneficiary_arrivalStatus: "beneficiary.currentVisaStatus",
  beneficiary_i94Number: "beneficiary.i94Number",
  beneficiary_statusExpiresOn: "beneficiary.i94ExpirationDate",
  // cityStateCountryOfBirth/ssn/currentEmployer*/usAddress/foreignAddress/
  // lastSharedAddress/underImmigrationProceedings/priorSpouses/
  // familyMembers/adjustmentOffice* intentionally left unmapped - either
  // combine multiple concepts into one free-text answer, have no
  // canonical equivalent yet, or (SSN) are excluded by policy.
};

const IR_VISA_CODES = ["ir1", "ir2", "ir3", "ir4", "ir5", "cr1", "cr2", "f1", "f2a", "f2b", "f3", "f4"];

async function applyMapForQuestionnaire(key, keyMap) {
  const questionnaire = await Questionnaire.findOne({ key, latestVersion: true }).select("_id").lean();
  if (!questionnaire) return { key, matched: 0, notFound: true };
  const ops = Object.entries(keyMap).map(([questionKey, canonicalPath]) => ({
    updateOne: {
      filter: { questionnaire: questionnaire._id, key: questionKey },
      update: { $set: { "mapping.canonicalPath": canonicalPath } },
    },
  }));
  const result = await Question.bulkWrite(ops);
  return { key, matched: result.matchedCount, modified: result.modifiedCount };
}

async function fixI130Checklists() {
  const results = [];
  results.push(await applyMapForQuestionnaire("k3_petitioner_checklist", K3_PETITIONER_MAP));
  results.push(await applyMapForQuestionnaire("k3_beneficiary_checklist", K3_BENEFICIARY_MAP));
  for (const code of IR_VISA_CODES) {
    results.push(await applyMapForQuestionnaire(`i130_${code}_petitioner_checklist`, IR_PETITIONER_MAP));
    results.push(await applyMapForQuestionnaire(`i130_${code}_beneficiary_checklist`, IR_BENEFICIARY_MAP));
  }
  return results;
}

// --- Fix 2: applicant.* -> real canonical namespace ---

const APPLICANT_RENAME_MAP = {
  "applicant.lastName": "person.lastName",
  "applicant.firstName": "person.firstName",
  "applicant.middleName": "person.middleName",
  "applicant.aNumber": "person.alienNumber",
  "applicant.countryOfBirth": "person.countryOfBirth",
  "applicant.countryOfCitizenship": "person.citizenship",
  "applicant.dateOfBirth": "person.dob",
  "applicant.gender": "person.gender",
  "applicant.phone": "contact.phone",
  "applicant.email": "contact.email",
  "applicant.i94Number": "immigration.i94.number",
  "applicant.passportNumber": "person.passport.number",
  "applicant.passportCountry": "person.passport.country",
  "applicant.passportExpirationDate": "person.passport.expirationDate",
  "applicant.currentVisaStatus": "immigration.currentStatus",
  "applicant.currentVisaExpiry": "immigration.currentStatusExpirationDate",
  "applicant.mailingAddress": "contact.address.line1",
  // applicant.physicalAddress -> UNSET (no distinct "physical, if
  // different from mailing" canonical field exists once mailingAddress
  // already claims contact.address.line1 - see file header).
};

async function fixApplicantNamespace() {
  const results = [];
  for (const key of ["h4_extension_questionnaire", "h4_extension_ead_questionnaire", "cos_f1_questionnaire", "cos_f2_questionnaire"]) {
    const questionnaire = await Questionnaire.findOne({ key, latestVersion: true }).select("_id").lean();
    if (!questionnaire) {
      results.push({ key, notFound: true });
      continue;
    }
    const renameOps = Object.entries(APPLICANT_RENAME_MAP).map(([from, to]) => ({
      updateMany: {
        filter: { questionnaire: questionnaire._id, "mapping.canonicalPath": from },
        update: { $set: { "mapping.canonicalPath": to } },
      },
    }));
    const unsetOp = {
      updateMany: {
        filter: { questionnaire: questionnaire._id, "mapping.canonicalPath": "applicant.physicalAddress" },
        update: { $unset: { "mapping.canonicalPath": "" } },
      },
    };
    const result = await Question.bulkWrite([...renameOps, unsetOp]);
    results.push({ key, matched: result.matchedCount, modified: result.modifiedCount });
  }
  return results;
}

async function applyCanonicalPathFixes() {
  const i130 = await fixI130Checklists();
  const applicantNamespace = await fixApplicantNamespace();
  return { i130, applicantNamespace };
}

module.exports = {
  applyCanonicalPathFixes,
  fixI130Checklists,
  fixApplicantNamespace,
  K3_PETITIONER_MAP,
  K3_BENEFICIARY_MAP,
  IR_PETITIONER_MAP,
  IR_BENEFICIARY_MAP,
  IR_VISA_CODES,
  APPLICANT_RENAME_MAP,
};

if (require.main === module) {
  const { connectTestDB, disconnectTestDB } = require("../../../test-utils/db");
  (async () => {
    const useTestDb = process.argv.includes("--test-db");
    if (useTestDb) {
      if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
      await connectTestDB();
    } else {
      await mongoose.connect(process.env.MONGODB_URI);
    }
    const result = await applyCanonicalPathFixes();
    console.log(JSON.stringify(result, null, 2));
    if (useTestDb) await disconnectTestDB();
    else await mongoose.disconnect();
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
