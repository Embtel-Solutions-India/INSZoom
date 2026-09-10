const { clean } = require("./shared");

const key = "eb1b";

// Anchored loosely enough to match "EB1B", "EB-1B", "EB 1B", "eb1-b" etc.,
// the same tolerance l1a.js's matcher uses for its own visa-type string.
function matches(value) {
  return /eb[\s-]?1[\s-]?b\b/i.test(String(value || ""));
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
}

// Petitioner (employer) checklist — "Documents Required", verbatim from the
// source checklist's base 6-item list (applies to every EB1-B petitioner).
const BASE_EMPLOYER_DOCUMENTS = [
  { name: "Petitioner's Tax Returns", documentType: "eb1b_petitioner_tax_returns", description: "Petitioner's filed tax returns.", category: "financial" },
  { name: "Copy of Incorporation Papers of Petitioner", documentType: "eb1b_petitioner_incorporation_papers", description: "Formation/incorporation documents for the petitioning entity.", category: "business" },
  { name: "Copy of Business License", documentType: "eb1b_petitioner_business_license", description: "Current business license for the petitioner.", category: "business" },
  { name: "Soft copy of letterhead in Word format", documentType: "eb1b_petitioner_letterhead", description: "Petitioner letterhead as an editable .docx file.", category: "business" },
  { name: "Offer Letter", documentType: "eb1b_offer_letter", description: "Signed offer letter for the beneficiary.", category: "employment" },
  { name: "Employment Agreement", documentType: "eb1b_employment_agreement", description: "Employment agreement between the petitioner and the beneficiary.", category: "employment" },
];

// Source's "A Private employer must:" conditional group — visible only when
// the petitioner identifies as a private employer (gated in
// employmentChecklists.js on employer_employerIsPrivate === "yes").
const PRIVATE_EMPLOYER_ACCOMPLISHMENTS_DOCUMENT = {
  name: "Evidence of Accomplishments", documentType: "eb1b_private_employer_accomplishments", description: "Evidence of the private employer's accomplishments.", category: "evidence",
};

// Source: "Resume, last 3 months pay stubs, and recent W2 for three
// full-time researchers, Private Employers employs" — modeled as 3 named
// researcher slots x 3 documents each (9 file items total), matching this
// codebase's existing convention for a fixed, small, named-item document set
// (see o1CriteriaQuestions' numbered criteria items) rather than introducing
// a new "repeatable file upload group" construct that has no precedent or
// frontend support anywhere else in the checklist system. Flagged for
// sign-off as a modeling judgment call, not a literal source instruction.
const PRIVATE_EMPLOYER_RESEARCHER_SLOTS = [1, 2, 3];
const PRIVATE_EMPLOYER_RESEARCHER_DOCUMENT_TEMPLATES = [
  { suffix: "resume", name: "Resume", description: "Resume for this full-time researcher." },
  { suffix: "pay_stubs", name: "Last 3 Months Pay Stubs", description: "Pay stubs covering the last 3 months for this full-time researcher." },
  { suffix: "w2", name: "Recent W2", description: "Most recent W2 for this full-time researcher." },
];

const employerDocuments = [
  ...BASE_EMPLOYER_DOCUMENTS.map((doc) => ({ ...doc, required: true, targetRole: "employer", status: "requested" })),
  { ...PRIVATE_EMPLOYER_ACCOMPLISHMENTS_DOCUMENT, required: true, targetRole: "employer", status: "requested" },
  ...PRIVATE_EMPLOYER_RESEARCHER_SLOTS.flatMap((slotNumber) =>
    PRIVATE_EMPLOYER_RESEARCHER_DOCUMENT_TEMPLATES.map((doc) => ({
      name: `Full-Time Researcher ${slotNumber} — ${doc.name}`,
      documentType: `eb1b_private_employer_researcher_${slotNumber}_${doc.suffix}`,
      description: doc.description,
      category: "employment",
      required: true,
      targetRole: "employer",
      status: "requested",
    }))
  ),
];

// Convenience export so employmentChecklists.js can gate the conditional
// documents above without re-deriving them from the array by index/name.
const PRIVATE_EMPLOYER_DOCUMENT_TYPES = employerDocuments
  .filter((doc) => doc.documentType === PRIVATE_EMPLOYER_ACCOMPLISHMENTS_DOCUMENT.documentType || doc.documentType.startsWith("eb1b_private_employer_researcher_"))
  .map((doc) => doc.documentType);

// Beneficiary checklist — Section H, "Beneficiary's Documents". Always
// visible/required (unlike criteria A-F below, which are individually
// optional but must satisfy at least 2 of 6 in aggregate).
const employeeDocuments = [
  { name: "Passport biographic page", documentType: "passport", description: "Passport biographic page.", required: true, category: "identity", targetRole: "employee", status: "requested" },
  { name: "Current visa / I-94", documentType: "eb1b_current_visa_i94", description: "Current visa stamp or I-94 record.", required: true, category: "immigration", targetRole: "employee", status: "requested" },
  { name: "Resume / CV", documentType: "updated_resume", description: "Current resume / CV.", required: true, category: "employment", targetRole: "employee", status: "requested" },
  { name: "Prior immigration approvals (H-1B, O-1, etc.)", documentType: "previous_i797_notices", description: "Prior USCIS approval or receipt notices, if any.", required: false, category: "immigration", targetRole: "employee", status: "requested" },
];

// EB1-B evidentiary criteria A-F (Outstanding Researcher/Professor,
// 8 CFR 204.5(i)(3)(i)) — verbatim from the source checklist. Every item is
// individually optional (USCIS requires satisfying at least 2 of these 6
// criteria, not all of them, and not every item within a satisfied
// criterion) — the aggregate "at least 2 of 6" rule is enforced separately
// (see employmentChecklists.js's EB1B_MIN_CRITERIA_REQUIRED / the checklist
// completion check), not per-item here.
const EB1B_CRITERIA_HEADING = "USCIS requires satisfying at least 2 of the following 6 criteria (A-F).";
const EB1B_CRITERIA = [
  {
    letter: "A",
    heading: "A. Evidence of original scientific or scholarly research contributions in the field.",
    items: [
      { name: "Documentation showing original scientific/scholarly research contributions such as patents, research papers, technologies, widely cited papers" },
    ],
  },
  {
    letter: "B",
    heading: "B. Evidence of authorship of scholarly books or articles (in scholarly journals with international circulation) in the field.",
    items: [
      { name: "Copies of the most significant publications (highlighted)" },
      { name: "Citation report (Google Scholar / Web of Science / Scopus)" },
      { name: "Evidence of high citation impact (comparative data if possible)" },
    ],
  },
  {
    letter: "C",
    heading: "C. Evidence of published material in professional publications written by others about the alien's work in the academic field.",
    items: [
      { name: "Copies of articles or citations in major journals or media about your work" },
    ],
  },
  {
    letter: "D",
    heading: "D. Evidence of membership in associations that require their members to demonstrate outstanding achievement.",
    items: [
      { name: "Membership Certificates" },
      { name: "Letter from the Professional Association confirming your Membership and outstanding achievements" },
    ],
  },
  {
    letter: "E",
    heading: "E. Receipt of major prizes or awards for outstanding achievement.",
    items: [
      { name: "Copies of award certificates and selection criteria" },
      { name: "Media articles or press releases (if applicable)", required: false },
    ],
  },
  {
    letter: "F",
    heading: "F. Evidence of participation, either on a panel or individually, as a judge of the work of others in the same or allied academic field.",
    items: [
      { name: "Documentation of service as a judge of the work of others (review panels, conference session chairs)" },
    ],
  },
];

const MIN_CRITERIA_REQUIRED = 2;

function normalizeEmployer(payload = {}) {
  return {
    // Nested under "company" (rather than flat on the employer object) so
    // employmentChecklists.js's sectionTitleFor() groups these under its
    // existing "company." -> "Company Information" prefix mapping instead
    // of falling through to the generic "General" section.
    company: {
      legalName: clean(payload.company?.legalName || payload.legalName || payload.companyName),
      address: clean(payload.company?.address || payload.address || payload.currentAddress),
      ein: clean(payload.company?.ein || payload.ein),
      businessType: clean(payload.company?.businessType || payload.businessType),
      dateEstablished: payload.company?.dateEstablished || payload.dateEstablished || "",
      employeeCount: payload.company?.employeeCount ?? payload.employeeCount ?? "",
      grossAnnualIncome: payload.company?.grossAnnualIncome ?? payload.grossAnnualIncome ?? "",
      netAnnualIncome: payload.company?.netAnnualIncome ?? payload.netAnnualIncome ?? "",
      naicsCode: clean(payload.company?.naicsCode || payload.naicsCode),
      employerIsPrivate: payload.company?.employerIsPrivate || payload.employerIsPrivate || "",
    },
    position: {
      jobTitle: clean(payload.position?.jobTitle || payload.jobTitle),
      socCode: clean(payload.position?.socCode || payload.socCode),
      worksiteAddress: clean(payload.position?.worksiteAddress || payload.worksiteAddress),
      offeredSalary: payload.position?.offeredSalary ?? payload.offeredSalary ?? "",
    },
    signingPerson: {
      firstName: clean(payload.signingPerson?.firstName || payload.signingFirstName),
      lastName: clean(payload.signingPerson?.lastName || payload.signingLastName),
      title: clean(payload.signingPerson?.title || payload.signingTitle),
      email: clean(payload.signingPerson?.email || payload.signingEmail),
      mobilePhone: clean(payload.signingPerson?.mobilePhone || payload.signingMobilePhone),
    },
  };
}

const emptyRecommender = () => ({ linkedinUrl: "" });
const emptyDependent = () => ({ firstName: "", lastName: "", relation: "", dateOfBirth: "", countryOfBirth: "" });

function normalizeEmployee(payload = {}, profile = {}) {
  const recommenders = Array.isArray(payload.recommenders) && payload.recommenders.length
    ? payload.recommenders.map((item) => ({ ...emptyRecommender(), ...item }))
    : [emptyRecommender(), emptyRecommender(), emptyRecommender(), emptyRecommender(), emptyRecommender(), emptyRecommender()];
  const hasDependents = payload.otherInformation?.hasDependents || payload.hasDependents || "";
  const eb1bDependents = Array.isArray(payload.eb1bDependents) && payload.eb1bDependents.length
    ? payload.eb1bDependents.map((item) => ({ ...emptyDependent(), ...item }))
    : [emptyDependent()];

  return {
    recommenders,
    personal: {
      lastName: clean(payload.personal?.lastName || payload.lastName || profile.lastName),
      firstName: clean(payload.personal?.firstName || payload.firstName || profile.firstName),
      dateOfBirth: payload.personal?.dateOfBirth || payload.dateOfBirth || profile.dateOfBirth || "",
      cityOfBirth: clean(payload.personal?.cityOfBirth || payload.cityOfBirth),
      stateOfBirth: clean(payload.personal?.stateOfBirth || payload.stateOfBirth),
      countryOfBirth: clean(payload.personal?.countryOfBirth || payload.countryOfBirth || profile.countryOfBirth),
      currentAddress: clean(payload.personal?.currentAddress || payload.currentAddress),
      email: clean(payload.personal?.email || payload.email || profile.email),
      phoneDaytime: clean(payload.personal?.phoneDaytime || payload.phoneDaytime),
      phoneEvening: clean(payload.personal?.phoneEvening || payload.phoneEvening),
      foreignAddress: clean(payload.personal?.foreignAddress || payload.foreignAddress),
    },
    immigrationStatus: {
      lastArrivalDate: payload.immigrationStatus?.lastArrivalDate || payload.lastArrivalDate || "",
      i94Number: clean(payload.immigrationStatus?.i94Number || payload.i94Number),
      statusExpiryDate: payload.immigrationStatus?.statusExpiryDate || payload.statusExpiryDate || profile.visaExpirationDate || "",
      ssn: clean(payload.immigrationStatus?.ssn || payload.ssn || profile.ssn),
      alienNumber: clean(payload.immigrationStatus?.alienNumber || payload.alienNumber || profile.alienRegistrationNumber),
      priorImmigrantPetitionFiled: payload.immigrationStatus?.priorImmigrantPetitionFiled || payload.priorImmigrantPetitionFiled || "",
    },
    otherInformation: {
      hasDependents,
    },
    eb1bDependents,
    updatedAt: new Date(),
  };
}

// Flat catalog of every scalar field the employer/employee normalizers above
// understand, for the document-intelligence auto-fill matcher to target and
// for employmentChecklists.js to turn into renderable Question objects.
// Repeatable sub-documents (recommenders, dependents) are listed with
// repeatable:true and surfaced for review, matching l1a.js's own convention.
function fieldCatalog() {
  const entries = [
    { path: "employer.company.legalName", label: "Company Name", section: "employer" },
    { path: "employer.company.address", label: "Current Address", section: "employer" },
    { path: "employer.company.ein", label: "IRS Employer Identification Number (EIN)", section: "employer" },
    { path: "employer.company.businessType", label: "Type of Business", section: "employer" },
    { path: "employer.company.dateEstablished", label: "Date Established", section: "employer", type: "date" },
    { path: "employer.company.employeeCount", label: "Current Number of Employees (on W2)", section: "employer", type: "number" },
    { path: "employer.company.grossAnnualIncome", label: "Gross Annual Income", section: "employer", type: "currency" },
    { path: "employer.company.netAnnualIncome", label: "Net Annual Income", section: "employer", type: "currency" },
    { path: "employer.company.naicsCode", label: "NAICS Code", section: "employer" },
    // Gates the private-employer conditional document group in
    // employmentChecklists.js (buildEb1bEmployerChecklist).
    { path: "employer.company.employerIsPrivate", label: "Is the Petitioner a Private Employer?", section: "employer", type: "radio" },
    { path: "employer.position.jobTitle", label: "Job Title Offered", section: "employer" },
    { path: "employer.position.socCode", label: "SOC Code", section: "employer" },
    { path: "employer.position.worksiteAddress", label: "Address Where the Beneficiary Is Going to Work", section: "employer" },
    { path: "employer.position.offeredSalary", label: "Salary (per annum)", section: "employer", type: "currency" },
    { path: "employer.signingPerson.firstName", label: "First Name of Signing Person", section: "employer" },
    { path: "employer.signingPerson.lastName", label: "Last Name of Signing Person", section: "employer" },
    { path: "employer.signingPerson.title", label: "Designation / Title of Signing Person", section: "employer" },
    { path: "employer.signingPerson.email", label: "Email of Signing Person", section: "employer", type: "email" },
    { path: "employer.signingPerson.mobilePhone", label: "Mobile Phone Number of Signing Person", section: "employer", type: "phone" },

    // Employee / beneficiary side
    {
      path: "employee.recommenders",
      label: "LinkedIn profiles of 6–7 recommenders (former managers, colleagues, or clients who can provide a recommendation letter)",
      section: "employee",
      repeatable: true,
      description: "We will prepare the draft letters; recommenders review and sign.",
    },
    { path: "employee.personal.lastName", label: "Last Name", section: "employee" },
    { path: "employee.personal.firstName", label: "First Name", section: "employee" },
    { path: "employee.personal.dateOfBirth", label: "Date of Birth", section: "employee", type: "date" },
    { path: "employee.personal.cityOfBirth", label: "City of Birth", section: "employee" },
    { path: "employee.personal.stateOfBirth", label: "State of Birth", section: "employee" },
    { path: "employee.personal.countryOfBirth", label: "Country of Birth", section: "employee" },
    { path: "employee.personal.currentAddress", label: "Current Address", section: "employee" },
    { path: "employee.personal.email", label: "E-mail Address", section: "employee", type: "email" },
    { path: "employee.personal.phoneDaytime", label: "Contact Number — Daytime", section: "employee", type: "phone" },
    { path: "employee.personal.phoneEvening", label: "Contact Number — Evening", section: "employee", type: "phone" },
    { path: "employee.personal.foreignAddress", label: "Foreign Address (Parents' Address)", section: "employee" },
    { path: "employee.immigrationStatus.lastArrivalDate", label: "Last Date of Arrival", section: "employee", type: "date" },
    { path: "employee.immigrationStatus.i94Number", label: "Latest I-94 #", section: "employee" },
    { path: "employee.immigrationStatus.statusExpiryDate", label: "Date Current Status Expires", section: "employee", type: "date" },
    { path: "employee.immigrationStatus.ssn", label: "SSN #", section: "employee" },
    { path: "employee.immigrationStatus.alienNumber", label: "A-Number #", section: "employee" },
    { path: "employee.immigrationStatus.priorImmigrantPetitionFiled", label: "Has Any Immigrant Visa Petition Ever Been Filed by You?", section: "employee", type: "radio" },
    { path: "employee.otherInformation.hasDependents", label: "Include Spouse/Children in This Application?", section: "employee", type: "radio" },
    // Named eb1bDependents (not the shared "employee.dependents" path) since
    // employmentChecklists.js's REPEATABLE_FIELDS map is keyed by literal
    // path across every visa, and H-1B's existing "employee.dependents"
    // entry already claims that key with a different, incompatible field
    // shape (passport/i94/marriageCertificate/etc.) — reusing it here would
    // silently apply H-1B's fields to this checklist instead of EB1-B's
    // simpler firstName/lastName/relation/dateOfBirth/countryOfBirth shape.
    {
      path: "employee.eb1bDependents",
      label: "Dependents (Spouse / Children)",
      section: "employee",
      repeatable: true,
      condition: { field: "employee.otherInformation.hasDependents", operator: "equals", value: "yes" },
    },
  ];
  return entries.map((entry) => ({
    ...entry,
    required: entry.condition ? false : entry.required !== false,
  }));
}

module.exports = {
  key,
  matches,
  slug,
  employerDocuments,
  employeeDocuments,
  normalizeEmployer,
  normalizeEmployee,
  fieldCatalog,
  EB1B_CRITERIA,
  EB1B_CRITERIA_HEADING,
  MIN_CRITERIA_REQUIRED,
  PRIVATE_EMPLOYER_ACCOMPLISHMENTS_DOCUMENT,
  PRIVATE_EMPLOYER_DOCUMENT_TYPES,
};
