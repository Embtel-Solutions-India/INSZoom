// Canonical paths the PERM (labor certification) checklists write to that the
// shared registry (CanonicalFieldRegistryService.BASE_FIELDS) did not know yet.
// Same extension mechanism as familyCanonicalPaths.js / the Phase-2/3B
// additions in BASE_FIELDS: ANY question.mapping.canonicalPath is promoted into
// Case.canonicalProfile verbatim by CanonicalBuilderService.addQuestionnaire
// Candidates, so a path only has to be REGISTERED (so checklistHealth, the
// mapping-graph editor and the autofill matcher recognise it) - no builder
// change is needed for scalar paths.
//
// Rules followed here:
//   - nothing below duplicates an existing canonical concept under a new name
//     (employer phone -> company.phone, company profile -> company.description,
//     employer address parts -> company.address.* all already exist and are
//     reused by permChecklists.js directly; they are listed ONLY where the
//     registry lacked them, with no aliases so the matcher never sees a
//     second candidate for the same concept);
//   - employer-side facts live under company.* (EmployerProfile owner),
//     employee-side under person./contact./education./immigration. (the
//     EmployeeProfile owner), and PERM-only questionnaire facts that have no
//     profile home under the dedicated perm.* namespace (owner "case").

const PERM_CANONICAL_FIELDS = Object.freeze([
  // ── PERM qualification answers (employee checklist) ─────────────────────
  { path: "perm.qualifyingExperienceWithPetitioner", aliases: ["qualifying experience with petitioner", "experience gained with the employer"], type: "text" },
  { path: "perm.qualifyingExperienceYears", aliases: ["years employed by petitioner", "qualifying experience years"], type: "number" },
  { path: "perm.qualifyingExperienceMonths", aliases: ["months employed by petitioner", "qualifying experience months"], type: "number" },
  { path: "perm.employerPaidEducationTraining", aliases: ["employer paid education or training"], type: "text" },
  { path: "perm.currentlyEmployedByPetitioner", aliases: ["currently employed by petitioner", "currently employed by the petitioning employer"], type: "text" },

  // ── Employee education extras (education.0 = highest/most recent degree) ─
  { path: "education.0.completionYear", aliases: [], type: "text" },
  { path: "education.0.institutionAddress", aliases: [], type: "text" },
  { path: "education.0.institutionCity", aliases: [], type: "text" },
  { path: "education.0.institutionState", aliases: [], type: "text" },
  { path: "education.0.institutionCountry", aliases: [], type: "text" },
  { path: "education.0.institutionZip", aliases: [], type: "text" },

  // ── Employer (company.*) additions ──────────────────────────────────────
  { path: "company.address.country", aliases: ["company country", "employer country"], type: "text" },
  { path: "company.address.county", aliases: ["company county", "employer county", "county area"], type: "text" },
  { path: "company.website", aliases: ["company website", "employer website"], type: "text" },
  { path: "company.fax", aliases: ["company fax", "employer fax"], type: "phone" },
  { path: "company.additionalPhone", aliases: ["additional contact number"], type: "phone" },
  { path: "company.stateIdNumber", aliases: ["state id number", "state employer account number"], type: "text" },
  { path: "company.isFederalContractor", aliases: ["federal contractor"], type: "boolean" },
  { path: "company.isAdaCompliant", aliases: ["ada compliant"], type: "boolean" },
  { path: "company.unionStatus", aliases: ["union shop", "union status"], type: "text" },
  { path: "company.apprenticeRegistrationNumber", aliases: ["apprentice registration number"], type: "text" },
  { path: "company.contact.phoneExtension", aliases: ["contact phone extension"], type: "text" },

  // ── Already-used paths the registry simply did not list ─────────────────
  // (no aliases: they only silence checklistHealth's "unrecognised path" flag)
  { path: "company.address", aliases: [], type: "address", composite: ["company.address.line1", "company.address.line2", "company.address.city", "company.address.state", "company.address.zip", "company.address.country"] },
  { path: "company.numberOfEmployees", aliases: [], type: "number" },
  { path: "company.description", aliases: [], type: "text" },
  { path: "company.contact.name", aliases: [], type: "text" },
  { path: "company.contact.title", aliases: [], type: "text" },
  { path: "company.contact.phone", aliases: [], type: "phone" },
  { path: "company.contact.email", aliases: [], type: "email" },
  { path: "education.0.degree", aliases: [], type: "text" },
  { path: "education.0.field", aliases: [], type: "text" },
  { path: "education.0.institution", aliases: [], type: "text" },
  { path: "perm.employmentHistory", aliases: ["employment history"], type: "array", repeatable: "employmentHistory" },
]);

// An "address"-type question stores an object { line1, line2, city, state,
// postalCode, country }. CanonicalBuilderService fans that object out into one
// candidate per part (each with its own provenance) using this key map.
const ADDRESS_PART_KEYS = Object.freeze({
  line1: "line1",
  street: "line1",
  addressLine1: "line1",
  line2: "line2",
  apartment: "line2",
  city: "city",
  state: "state",
  province: "province",
  postalCode: "zip",
  zipCode: "zip",
  zip: "zip",
  country: "country",
  county: "county",
});

module.exports = { PERM_CANONICAL_FIELDS, ADDRESS_PART_KEYS };
