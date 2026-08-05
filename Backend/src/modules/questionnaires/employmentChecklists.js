// Converts the hardcoded H-1B / L-1A employer, employee, and business-plan
// checklists (Backend/src/modules/employment-workflow/questionnaires/{h1b,l1a}.js)
// into real, editable Questionnaire/Question template definitions, in the same
// shape as questionnaire.service.js's VISA_TEMPLATE_DEFINITIONS. This lets case
// managers manage these checklists (add/remove questions, assign to a case)
// from the admin Questionnaire Templates page instead of only via source code.
//
// The employment-workflow module itself is left untouched (see plan: kept as
// a fallback) — this file only reads its static document/field definitions.

const h1b = require("../employment-workflow/questionnaires/h1b");
const l1a = require("../employment-workflow/questionnaires/l1a");
const p = require("../employment-workflow/questionnaires/p");
const o1 = require("../employment-workflow/questionnaires/o1");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];

const DOCUMENT_CATEGORY_SECTIONS = {
  business: "Business Documents",
  education: "Education Documents",
  employment: "Employment Documents",
  immigration: "Immigration Documents",
  identity: "Identity Documents",
  us_business: "U.S. Company Documents",
  foreign_business: "Foreign Company Documents",
  p1a_evidence: "Evidence of International Recognition",
  p1b_evidence: "For P-1B (Entertainment Group)",
  p3_evidence: "For P-3 (Culturally Unique Program)",
};

// Ordered so more specific prefixes are checked before their parents
// (e.g. "businessPlan.usCompany." before a hypothetical bare "usCompany.").
const SECTION_PREFIX_MAP = [
  ["pClassification", "P Classification"],
  ["oClassification", "O-1 Classification"],
  ["businessPlan.foreignParentCompany.", "Foreign Parent Company"],
  ["businessPlan.usCompany.", "U.S. Company (Business Plan)"],
  ["businessPlan.executiveProfile.", "Executive / Beneficiary Profile"],
  ["businessPlan.marketAnalysis.", "Market, Competition & Growth Strategy"],
  ["lca.", "LCA Filing"],
  ["company.", "Company Information"],
  ["usCompany.", "US Company"],
  ["foreignCompany.", "Foreign Company"],
  ["signingPerson.", "Signing Person"],
  ["position.", "Position Information"],
  ["endClient.", "End Client"],
  ["jobDescription.", "Job Description"],
  ["workforce.", "Workforce"],
  ["workLocations", "Work Locations"],
  ["personal.", "Personal Information"],
  ["immigrationStatus.", "Immigration Status"],
  ["education.", "Education"],
  ["immigrationHistory.", "Immigration History"],
  ["otherInformation.", "Other Information"],
  ["previousHLStatusHistory", "Prior H/L Status History"],
  ["dependents", "Dependents"],
  ["filingCapType", "Filing Details"],
  ["filingType", "Filing Details"],
];

const YES_NO_FIELDS = new Set([
  "firstLcaFiling", "dolVerified", "insideUnitedStates", "hasSsn", "hasDriverLicense",
  "hasUsMastersOrHigher", "credentialEvaluationRequired", "hasH4Dependents", "replaceI94",
  "inRemovalProceedings", "employerFiledGreenCard", "heldH1bLastSevenYears", "deniedH1bLastSevenYears",
  "hasValidPassport", "hasDependents", "heldL1ALastSevenYears", "deniedL1ALastSevenYears",
  "hasLoiMouContracts", "proofOfOwnershipAvailable",
  "heldPVisaLastSevenYears", "deniedPVisaLastSevenYears",
  "heldO1VisaLastSevenYears", "deniedO1VisaLastSevenYears",
  "isH1bDependentOrWillfulViolator", "isAcwiaFeeExempt",
]);

const SELECT_FIELDS = {
  relationshipType: l1a.RELATIONSHIP_TYPES,
  salaryUnit: l1a.SALARY_UNITS,
};

// Child-field descriptions for the handful of repeatable groups in the catalogs,
// so the frontend can render a generic repeating-row editor instead of bespoke
// per-field JSX (Question itself has no nested-schema concept for repeatables).
const REPEATABLE_FIELDS = {
  "employer.workLocations": [
    { key: "companyName", label: "Company Name", type: "text" },
    { key: "street", label: "Street", type: "text" },
    { key: "county", label: "County", type: "text" },
    { key: "city", label: "City", type: "text" },
    { key: "state", label: "State", type: "text" },
    { key: "zipCode", label: "Zip Code", type: "text" },
  ],
  "employee.dependents": [
    { key: "name", label: "Name", type: "text" },
    { key: "relationship", label: "Relationship", type: "text" },
    { key: "passport", label: "Passport Number", type: "text" },
    { key: "i94", label: "I-94 Number", type: "text" },
    { key: "previousApprovalNotices", label: "Previous Approval Notices", type: "text" },
    { key: "marriageCertificate", label: "Marriage Certificate", type: "text" },
    { key: "birthCertificate", label: "Birth Certificate", type: "text" },
    { key: "hasSsn", label: "Has SSN", type: "radio" },
    { key: "hasDriverLicense", label: "Has Driver License", type: "radio" },
  ],
  "employee.previousHLStatusHistory": [
    { key: "name", label: "Name", type: "text" },
    { key: "visaClassification", label: "Visa Classification", type: "select", options: ["H-1B", "H-4", "L-1A", "L-1B", "L-2"] },
    { key: "arrivalDate", label: "Arrival Date", type: "date" },
    { key: "departureDate", label: "Departure Date", type: "date" },
  ],
  "employer.businessPlan.foreignParentCompany.shareholders": [
    { key: "name", label: "Name", type: "text" },
    { key: "percentage", label: "Percentage", type: "text" },
    { key: "role", label: "Role", type: "text" },
  ],
};

function slugSection(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function sectionTitleFor(path) {
  const rest = path.replace(/^(employer|employee)\./, "");
  const match = SECTION_PREFIX_MAP.find(([prefix]) => rest.startsWith(prefix));
  return match ? match[1] : "General";
}

function inferFieldType(fieldName) {
  if (SELECT_FIELDS[fieldName]) return "select";
  if (YES_NO_FIELDS.has(fieldName)) return "radio";
  const lower = fieldName.toLowerCase();
  if (/email/.test(lower)) return "email";
  if (/phone/.test(lower)) return "phone";
  if (/date/.test(lower)) return "date";
  if (/(duties|description|responsibilit|achievement|strategy|risk|structure|breakdown)/.test(lower)) return "textarea";
  return "text";
}

function buildQuestion(key, label, type, sectionTitle, order, extras = {}) {
  return {
    key,
    label,
    type,
    sectionKey: slugSection(sectionTitle),
    pageKey: slugSection(sectionTitle),
    order,
    required: Boolean(extras.required),
    description: extras.description,
    options: (extras.options || []).map((value) => (typeof value === "object" ? value : { label: value, value })),
    evidenceCategory: extras.evidenceCategory,
    metadata: extras.metadata || {},
    // Omitted entirely (not even as an empty object) when a question has no
    // canonical mapping, so questionnaire.service.js's reconciliation only
    // ever touches/patches the handful of questions that actually carry one.
    ...(extras.mapping ? { mapping: extras.mapping } : {}),
    visibility: extras.visibility || {},
    conditionalLogic: extras.conditionalLogic || { mode: "all", rules: [], groups: [] },
    repeatable: Boolean(extras.repeatable),
  };
}

// Maps the employee/beneficiary side's fieldCatalog paths to the case's
// canonical profile (CanonicalBuilderService.addQuestionnaireCandidates
// reads question.mapping.canonicalPath — the same admin-facing mechanism
// the questionnaire builder uses for a custom question). Without this, a
// submitted employee answer has no canonicalPath and never reaches the
// canonical profile, so it can never populate USCIS form (I-129 +
// supplements) autofill or show up as canonical data in the admin portal.
// Shared across H-1B/L-1A/O-1/P — every visa's employee.personal.*/
// employee.immigrationStatus.* section uses this same shape (see each
// visa's own questionnaires/*.js fieldCatalog()). Scoped to the employee
// side only: employer/company-side answers are a distinct concern (the
// Company model already feeds company.* canonical paths).
const EMPLOYEE_CANONICAL_PATHS = {
  "personal.firstName": "person.firstName",
  "personal.middleName": "person.middleName",
  "personal.lastName": "person.lastName",
  "personal.gender": "person.gender",
  "personal.dateOfBirth": "person.dob",
  "personal.countryOfBirth": "person.countryOfBirth",
  "personal.countryOfCitizenship": "person.citizenship",
  "personal.alienRegistrationNumber": "person.alienNumber",
  "personal.passportNumber": "person.passport.number",
  "personal.passportIssueDate": "person.passport.issueDate",
  "personal.passportExpirationDate": "person.passport.expirationDate",
  "personal.passportCountryOfIssuance": "person.passport.country",
  "personal.currentUsAddress.street": "contact.address.line1",
  "personal.currentUsAddress.city": "contact.address.city",
  "personal.currentUsAddress.state": "contact.address.state",
  "personal.currentUsAddress.zipCode": "contact.address.zip",
  "immigrationStatus.currentVisaStatus": "immigration.currentStatus",
  "immigrationStatus.i94Number": "immigration.i94.number",
};

function canonicalPathForEntry(entry) {
  if (!entry.path.startsWith("employee.")) return undefined;
  const canonicalPath = EMPLOYEE_CANONICAL_PATHS[entry.path.replace(/^employee\./, "")];
  return canonicalPath ? { canonicalPath } : undefined;
}

// A catalog entry may carry an optional `condition` — either a single
// {field, operator, value} rule or a {mode, rules:[...]} group, with `field`
// as a dotted fieldCatalog() path — so a field's visibility can mirror the
// source's "if applicable" branching. Converted to the underscored key format
// questions are built with (same transform as the question's own key).
function conditionalLogicFromEntry(entry) {
  if (!entry.condition) return undefined;
  const rules = entry.condition.rules || [entry.condition];
  return {
    mode: entry.condition.mode || "all",
    rules: rules.map((rule) => ({ questionKey: rule.field.replace(/\./g, "_"), operator: rule.operator || "equals", value: rule.value })),
    groups: [],
  };
}

// Builds field (non-document) questions from a registry fieldCatalog() array,
// filtered to entries belonging to this checklist. Tracks section order-of-
// first-appearance and a per-section counter so `order` is stable and the
// returned `sections` list matches what ensureDefaultVisaTemplates() expects.
function fieldQuestionsFromCatalog(catalogEntries, visibility) {
  const sectionOrder = [];
  const counters = new Map();
  const questions = catalogEntries.map((entry) => {
    const title = sectionTitleFor(entry.path);
    if (!sectionOrder.includes(title)) sectionOrder.push(title);
    const nextOrder = (counters.get(title) || 0) + 1;
    counters.set(title, nextOrder);
    const fieldName = entry.path.split(".").pop();
    const type = entry.repeatable ? "repeating_group" : (entry.type || inferFieldType(fieldName));
    return buildQuestion(entry.path.replace(/\./g, "_"), entry.label, type, title, nextOrder, {
      required: Boolean(entry.required),
      options: entry.options || SELECT_FIELDS[fieldName] || (type === "radio" ? ["Yes", "No"] : []),
      // masterDataPath (when a catalog entry specifies one, e.g. a variant
      // selector like pClassification/oClassification) takes over
      // inferMasterDataPath()'s section-based fallback in
      // questionnaire.service.js, so the answer lands at a known, stable
      // path (e.g. "visaVariant") in case.questionnaireData.masterData
      // instead of a generated per-section path — see resolveDisplayVisa.
      metadata: entry.repeatable
        ? { sourcePath: entry.path, repeatableFields: REPEATABLE_FIELDS[entry.path] || [], ...(entry.masterDataPath ? { masterDataPath: entry.masterDataPath } : {}) }
        : { sourcePath: entry.path, ...(entry.masterDataPath ? { masterDataPath: entry.masterDataPath } : {}) },
      mapping: canonicalPathForEntry(entry),
      visibility,
      repeatable: Boolean(entry.repeatable),
      conditionalLogic: conditionalLogicFromEntry(entry),
    });
  });
  return { sectionOrder, questions };
}

function documentQuestions(documents, visibility, sectionOrder, counters) {
  return documents.map((doc) => {
    const title = DOCUMENT_CATEGORY_SECTIONS[doc.category] || "Documents";
    if (!sectionOrder.includes(title)) sectionOrder.push(title);
    const nextOrder = (counters.get(title) || 0) + 1;
    counters.set(title, nextOrder);
    return buildQuestion(doc.documentType, doc.name, "file", title, nextOrder, {
      description: doc.description,
      required: Boolean(doc.required),
      evidenceCategory: doc.category,
      metadata: { documentType: doc.documentType, category: doc.category },
      visibility,
    });
  });
}

function definitionFromParts({ key, title, visaType, checklistRole, description, documentSectionOrder, documentQuestionList, fieldResult, assignmentRules }) {
  const sections = [...documentSectionOrder, ...fieldResult.sectionOrder];
  return {
    key,
    title,
    visaType,
    checklistRole,
    ...(assignmentRules ? { assignmentRules } : {}),
    isDefault: true,
    // Left in "draft" (matching every other built-in template, e.g. h1b_questionnaire)
    // so case managers can add/remove questions immediately — assertDraft() blocks
    // structural edits once a questionnaire is "published", and assignment/answering
    // works fine against a draft template, so there's no reason to publish these.
    description,
    sections,
    questions: [...documentQuestionList, ...fieldResult.questions],
  };
}

// Verbatim intro paragraphs from the authoritative source, shown as each
// checklist's own description.
const H1B_EMPLOYER_CHECKLIST_INTRO = "Please fill in the following information. If you have any questions, please feel free to contact us. Make sure to share the documents at one to initiate the process smoothly-";
const H1B_EMPLOYEE_CHECKLIST_INTRO = "Please complete the questionnaire with as much detail as possible to enable us to create an accurate petition";
// Source's PART-1 note, verbatim, carried on the DOL-verification field since
// it directly follows that question and gates the FEIN-proof document below.
const H1B_PART1_NOTE = "IF YES, Proceed to the PART-2. If NO, please let us know. We can help with that. Separate charges will be applied. Without this step, we cannot file LCA. Please send any one of the following documents:";

function buildH1bEmployerChecklist() {
  const visibility = { roles: ["employer", ...STAFF_ROLES], portals: ["employer", "admin"] };
  const documentSectionOrder = [];
  const counters = new Map();
  const documentQuestionList = documentQuestions(h1b.employerDocuments, visibility, documentSectionOrder, counters);
  const feinProof = buildQuestion("irs_fein_assignment_letter", "Documentation from IRS noting assignment of FEIN", "file", "Business Documents", (counters.get("Business Documents") || 0) + 1, {
    description: "FEIN proof document — required when the LCA has been filed for the first time and DOL verification has not yet been done.",
    evidenceCategory: "business",
    metadata: { documentType: "irs_fein_assignment_letter", category: "business" },
    visibility,
    conditionalLogic: {
      mode: "all",
      rules: [
        { questionKey: "employer_lca_firstLcaFiling", operator: "equals", value: "yes" },
        { questionKey: "employer_lca_dolVerified", operator: "equals", value: "no" },
      ],
      groups: [],
    },
  });
  documentQuestionList.push(feinProof);
  const fieldResult = fieldQuestionsFromCatalog(
    h1b.fieldCatalog().filter((entry) => entry.section === "employer"),
    visibility,
  );
  const dolVerifiedQuestion = fieldResult.questions.find((question) => question.key === "employer_lca_dolVerified");
  if (dolVerifiedQuestion) dolVerifiedQuestion.description = H1B_PART1_NOTE;
  return definitionFromParts({
    key: "h1b_employer_checklist",
    title: "H-1B Employer Checklist",
    visaType: "H1B",
    checklistRole: "employer",
    description: H1B_EMPLOYER_CHECKLIST_INTRO,
    documentSectionOrder,
    documentQuestionList,
    fieldResult,
  });
}

function buildH1bEmployeeChecklist() {
  const visibility = { roles: ["employee", ...STAFF_ROLES], portals: ["employee", "admin"] };
  const documentSectionOrder = [];
  const counters = new Map();
  const documentQuestionList = documentQuestions(h1b.employeeDocuments, visibility, documentSectionOrder, counters);
  documentQuestionList.push(
    buildQuestion("cap_selection_notice", "H1B CAP Selection Notice (I-797C, Notice of Action)", "file", "Immigration Documents", (counters.get("Immigration Documents") || 0) + 1, {
      description: "USCIS H-1B cap lottery selection notice, required for a new cap-subject filing.",
      evidenceCategory: "immigration",
      metadata: { documentType: "cap_selection_notice", category: "immigration" },
      visibility,
      conditionalLogic: { mode: "all", rules: [{ questionKey: "employee_filingType", operator: "equals", value: "New H1B" }], groups: [] },
    }),
    buildQuestion("f1_opt_stem_documents", "I-20/F1 Approval Notices", "file", "Immigration Documents", (counters.get("Immigration Documents") || 0) + 2, {
      description: "I-20/F-1 approval notices, required if you were in the USA on a student visa (F-1/OPT/STEM OPT).",
      evidenceCategory: "immigration",
      metadata: { documentType: "f1_opt_stem_documents", category: "immigration" },
      visibility,
      // Question.js's pre-validate hook mirrors conditionalLogic.rules[0] back into the
      // legacy `showIf` field, whose operator enum has no "in"/"not_in" — so this uses an
      // "any" group of equals checks instead of a single "in" rule to avoid that crash.
      conditionalLogic: {
        mode: "any",
        rules: ["F-1", "OPT", "STEM OPT"].map((value) => ({ questionKey: "employee_immigrationStatus_currentVisaStatus", operator: "equals", value })),
        groups: [],
      },
    }),
  );
  // "Documents Required from Dependents (if applying for H-4 for family):" —
  // same 6-item list as the source, conditional on the employee having H-4
  // dependents. Reuses documentQuestions() for consistent section placement,
  // then layers the shared condition on afterward.
  const dependentConditionalLogic = { mode: "all", rules: [{ questionKey: "employee_immigrationHistory_hasH4Dependents", operator: "equals", value: "yes" }], groups: [] };
  const dependentDocumentQuestions = documentQuestions(h1b.dependentDocuments, visibility, documentSectionOrder, counters)
    .map((question) => ({ ...question, conditionalLogic: dependentConditionalLogic }));
  documentQuestionList.push(...dependentDocumentQuestions);
  const fieldResult = fieldQuestionsFromCatalog(
    h1b.fieldCatalog().filter((entry) => entry.section === "employee"),
    visibility,
  );
  // filingType has no fixed option list upstream; give it sensible options so the
  // cap-selection-notice condition above has something concrete to match against.
  const filingTypeQuestion = fieldResult.questions.find((question) => question.key === "employee_filingType");
  if (filingTypeQuestion) {
    filingTypeQuestion.type = "select";
    filingTypeQuestion.options = ["New H1B", "H1B Extension", "H1B Transfer", "H1B Amendment", "H1B Concurrent"].map((value) => ({ label: value, value }));
  }
  return definitionFromParts({
    key: "h1b_employee_checklist",
    title: "H-1B Employee Checklist",
    visaType: "H1B",
    checklistRole: "employee",
    description: H1B_EMPLOYEE_CHECKLIST_INTRO,
    documentSectionOrder,
    documentQuestionList,
    fieldResult,
  });
}

function buildL1aEmployerChecklist() {
  const visibility = { roles: ["employer", ...STAFF_ROLES], portals: ["employer", "admin"] };
  const documentSectionOrder = [];
  const counters = new Map();
  // l1a.employerDocuments already contains Stock Ownership Certificates in its
  // correct source position (13th of the 16 U.S.-company documents, between
  // Business Plan and Organizational Chart) — only its visibility is
  // conditional (hidden for a Branch relationship), applied in place here so
  // the item is neither duplicated nor reordered to the end of the section.
  const stockOwnershipConditionalLogic = {
    mode: "all",
    rules: [
      { questionKey: "employer_foreignCompany_relationshipType", operator: "exists" },
      { questionKey: "employer_foreignCompany_relationshipType", operator: "not_equals", value: "Branch" },
    ],
    groups: [],
  };
  const documentQuestionList = documentQuestions(l1a.employerDocuments, visibility, documentSectionOrder, counters)
    .map((question) => (
      question.key === l1a.STOCK_OWNERSHIP_CERTIFICATES_DOCUMENT.documentType
        ? { ...question, conditionalLogic: stockOwnershipConditionalLogic }
        : question
    ));
  // Source's foreign-documents item 13 ("Detailed Managerial Duties ... % of
  // each: a-d") is a percentage breakdown, not a file upload — insert it as
  // 4 number questions right after item 12 (Minutes of the Meeting) so the
  // rendered order matches the source exactly, rather than appending it to
  // fieldCatalog() where it would render after every other field/document.
  const minutesIndex = documentQuestionList.findIndex((question) => question.key === "minutes_dispatching_beneficiary");
  const managerialDutyQuestions = l1a.MANAGERIAL_DUTY_BREAKDOWN_FIELDS.map((field) =>
    buildQuestion(`employer_foreignCompany_managerialDutiesBreakdown_${field.key}`, field.label, "number", "Foreign Company Documents", 0, {
      required: true,
      metadata: { sourcePath: `employer.foreignCompany.managerialDutiesBreakdown.${field.key}` },
      visibility,
    })
  );
  documentQuestionList.splice(minutesIndex === -1 ? documentQuestionList.length : minutesIndex + 1, 0, ...managerialDutyQuestions);
  // The splice above shifts everything after it out of sequence — renumber
  // "order" within the Foreign Company Documents section so it stays 1..N.
  let foreignDocOrder = 0;
  for (const question of documentQuestionList) {
    if (question.sectionKey === slugSection("Foreign Company Documents")) {
      foreignDocOrder += 1;
      question.order = foreignDocOrder;
    }
  }
  // Not one of the 16/15 named source documents — it exists to let the
  // employer attach evidence for the business plan's own "(yes/no — attach)"
  // instruction in §2.3. Flagged for sign-off as an addition beyond the
  // literal source document lists.
  documentQuestionList.push(
    buildQuestion(l1a.LOI_MOU_CONTRACTS_DOCUMENT.documentType, l1a.LOI_MOU_CONTRACTS_DOCUMENT.name, "file", "U.S. Company Documents", (counters.get("U.S. Company Documents") || 0) + 1, {
      description: l1a.LOI_MOU_CONTRACTS_DOCUMENT.description,
      evidenceCategory: "us_business",
      metadata: { documentType: l1a.LOI_MOU_CONTRACTS_DOCUMENT.documentType, category: "us_business" },
      visibility,
      conditionalLogic: { mode: "all", rules: [{ questionKey: "employer_businessPlan_usCompany_hasLoiMouContracts", operator: "equals", value: "yes" }], groups: [] },
    }),
  );
  const fieldResult = fieldQuestionsFromCatalog(
    l1a.fieldCatalog().filter((entry) => entry.section === "employer" && !entry.path.startsWith("employer.businessPlan.")),
    visibility,
  );
  return definitionFromParts({
    key: "l1a_employer_checklist",
    title: "L-1A Employer Checklist",
    visaType: "L1A",
    checklistRole: "employer",
    description: "Petitioner (U.S. and foreign company) document checklist and company/position information for an L-1A petition.",
    documentSectionOrder,
    documentQuestionList,
    fieldResult,
  });
}

function buildL1aEmployeeChecklist() {
  const visibility = { roles: ["employee", ...STAFF_ROLES], portals: ["employee", "admin"] };
  const documentSectionOrder = [];
  const counters = new Map();
  const documentQuestionList = documentQuestions(l1a.employeeDocuments, visibility, documentSectionOrder, counters);
  const fieldResult = fieldQuestionsFromCatalog(
    l1a.fieldCatalog().filter((entry) => entry.section === "employee"),
    visibility,
  );
  return definitionFromParts({
    key: "l1a_employee_checklist",
    title: "L-1A Employee Checklist",
    visaType: "L1A",
    checklistRole: "employee",
    description: "Beneficiary document checklist and personal/immigration information for an L-1A petition.",
    documentSectionOrder,
    documentQuestionList,
    fieldResult,
  });
}

function buildL1aBusinessPlanChecklist() {
  const visibility = { roles: ["employer", ...STAFF_ROLES], portals: ["employer", "admin"] };
  const fieldResult = fieldQuestionsFromCatalog(
    l1a.fieldCatalog().filter((entry) => entry.path.startsWith("employer.businessPlan.")),
    visibility,
  );
  return definitionFromParts({
    key: "l1a_business_plan_checklist",
    title: "L-1A Business Plan Checklist",
    visaType: "L1A",
    checklistRole: "business_plan",
    description: l1a.BUSINESS_PLAN_INTRO,
    documentSectionOrder: [],
    documentQuestionList: [],
    fieldResult,
    // Only required for a New Office petition — gated on the "Is this a New
    // Office petition?" intake question (BAIS/Frontend Intake.jsx,
    // persisted as case.assessmentAnswers.newOfficePetition) via
    // ImmigrationKnowledgeEngineService.questionnaireApplies().
    assignmentRules: { requiresNewOfficePetition: true },
  });
}

// P Visa (P-1A Athlete / P-1B Entertainment Group / P-3 Culturally Unique
// Program) — ONE shared employer + ONE shared employee template for all
// three sub-types (visaType stays the single "P"), not three triplicated
// templates. The sub-type is captured by a required "P Classification"
// field (pClassification — an addition beyond the literal source, per the
// sub-type-selection mechanic; flagged for sign-off) asked up front in the
// employer checklist; each sub-type's evidence-document group is gated on
// that field's answer via the same condition engine L-1A already uses for
// its stock-ownership-certificate and LOI/MOU conditional documents, so a
// non-selected sub-type's group is hidden entirely, not shown-as-optional.
function buildPEmployerChecklist() {
  const visibility = { roles: ["employer", ...STAFF_ROLES], portals: ["employer", "admin"] };
  const documentSectionOrder = [];
  const counters = new Map();

  const commonDocs = p.employerDocuments.filter((doc) => doc.category === "business");
  const p1aDocs = p.employerDocuments.filter((doc) => doc.category === "p1a_evidence");
  const p1bDocs = p.employerDocuments.filter((doc) => doc.category === "p1b_evidence");
  const p3Docs = p.employerDocuments.filter((doc) => doc.category === "p3_evidence");

  const gateOn = (value) => ({ mode: "all", rules: [{ questionKey: "employer_pClassification", operator: "equals", value }], groups: [] });

  const commonDocumentQuestions = documentQuestions(commonDocs, visibility, documentSectionOrder, counters);
  const p1aDocumentQuestions = documentQuestions(p1aDocs, visibility, documentSectionOrder, counters)
    .map((question) => ({ ...question, conditionalLogic: gateOn("P-1A") }));
  const p1bDocumentQuestions = documentQuestions(p1bDocs, visibility, documentSectionOrder, counters)
    .map((question) => ({ ...question, conditionalLogic: gateOn("P-1B") }));
  const p3DocumentQuestions = documentQuestions(p3Docs, visibility, documentSectionOrder, counters)
    .map((question) => ({ ...question, conditionalLogic: gateOn("P-3") }));
  const documentQuestionList = [...commonDocumentQuestions, ...p1aDocumentQuestions, ...p1bDocumentQuestions, ...p3DocumentQuestions];

  const fieldResult = fieldQuestionsFromCatalog(
    p.fieldCatalog().filter((entry) => entry.section === "employer"),
    visibility,
  );

  // Source order is company/position fields THEN "Documents Required" (the
  // opposite of definitionFromParts' doc-first default), so fields are
  // placed first here to preserve the source's actual section order.
  return {
    key: "p_employer_checklist",
    title: "Employer Checklist for P Visa",
    visaType: "P",
    checklistRole: "employer",
    isDefault: true,
    description: "",
    sections: [...fieldResult.sectionOrder, ...documentSectionOrder],
    questions: [...fieldResult.questions, ...documentQuestionList],
  };
}

function buildPEmployeeChecklist() {
  const visibility = { roles: ["employee", ...STAFF_ROLES], portals: ["employee", "admin"] };
  const documentSectionOrder = [];
  const counters = new Map();
  const documentQuestionList = documentQuestions(p.employeeDocuments, visibility, documentSectionOrder, counters);
  const fieldResult = fieldQuestionsFromCatalog(
    p.fieldCatalog().filter((entry) => entry.section === "employee"),
    visibility,
  );
  // Same source order as the employer checklist: "1. Information About YOU"
  // fields first, then "Documents Required" — fields placed first here too.
  return {
    key: "p_employee_checklist",
    title: "Employee Checklist for P Visa",
    visaType: "P",
    checklistRole: "employee",
    isDefault: true,
    description: "",
    sections: [...fieldResult.sectionOrder, ...documentSectionOrder],
    questions: [...fieldResult.questions, ...documentQuestionList],
  };
}

// Converts one variant's criteria array (o1.O1A_CRITERIA / o1.O1B_CRITERIA)
// into gated Question objects. Each criterion becomes its own micro-section
// ("O-1A Criterion N") acting as the "labelled group" the task asks for —
// there's no separate grouping construct in this Question model beyond
// sectionKey, so section = group, exactly like every other checklist here.
// Criterion 8's three lettered sub-groups (A/B/C) each get their own
// micro-section for the same reason. Every criteria question is gated on
// employer_oClassification === variantValue (hidden entirely, not
// shown-as-optional, for the non-selected variant) and left OPTIONAL
// regardless of any per-item "(if any)" marker — USCIS requires meeting
// SOME, not ALL, of these criteria, so the client supplies whatever
// evidence applies (required-map confirmed at sign-off).
// FOLLOW-UP (not this phase, confirmed at sign-off): add a "must satisfy at
// least N of these criteria" validation — e.g. surfaced on the case
// checklist once enough criterion groups have at least one uploaded
// document — rather than leaving every criterion silently optional forever.
function o1CriteriaQuestions(criteria, variantLabel, variantValue, groupIntro, visibility, documentSectionOrder, counters) {
  const gate = { mode: "all", rules: [{ questionKey: "employer_oClassification", operator: "equals", value: variantValue }], groups: [] };
  const category = `${variantValue.toLowerCase().replace("-", "")}_criteria`;
  const questions = [];
  let introRemaining = groupIntro;
  const withIntro = (text) => {
    if (!introRemaining) return text;
    const combined = `${introRemaining} ${text}`;
    introRemaining = "";
    return combined;
  };

  criteria.forEach((criterion) => {
    if (criterion.subgroups) {
      criterion.subgroups.forEach((subgroup) => {
        const title = `${variantLabel} Criterion ${criterion.number}${subgroup.letter}`;
        if (!documentSectionOrder.includes(title)) documentSectionOrder.push(title);
        if (subgroup.type === "textarea") {
          const nextOrder = (counters.get(title) || 0) + 1;
          counters.set(title, nextOrder);
          questions.push(buildQuestion(
            o1.slug(`${variantValue}_c${criterion.number}${subgroup.letter}_${subgroup.title}`),
            subgroup.label,
            "textarea",
            title,
            nextOrder,
            {
              description: withIntro(`${criterion.heading} ${subgroup.description}`),
              required: false,
              metadata: { criterionNumber: criterion.number, subgroup: subgroup.letter },
              visibility,
              conditionalLogic: gate,
            }
          ));
          return;
        }
        subgroup.items.forEach((item) => {
          const nextOrder = (counters.get(title) || 0) + 1;
          counters.set(title, nextOrder);
          const documentType = o1.slug(`${variantValue}_c${criterion.number}${subgroup.letter}_${item.name}`);
          questions.push(buildQuestion(documentType, item.name, "file", title, nextOrder, {
            description: withIntro(`${criterion.heading} — ${subgroup.title}`),
            required: false,
            evidenceCategory: category,
            metadata: { documentType, category, criterionNumber: criterion.number, subgroup: subgroup.letter },
            visibility,
            conditionalLogic: gate,
          }));
        });
      });
      return;
    }
    const title = `${variantLabel} Criterion ${criterion.number}`;
    if (!documentSectionOrder.includes(title)) documentSectionOrder.push(title);
    criterion.items.forEach((item) => {
      const nextOrder = (counters.get(title) || 0) + 1;
      counters.set(title, nextOrder);
      const documentType = o1.slug(`${variantValue}_c${criterion.number}_${item.name}`);
      questions.push(buildQuestion(documentType, item.name, "file", title, nextOrder, {
        description: withIntro(criterion.heading),
        required: false,
        evidenceCategory: category,
        metadata: { documentType, category, criterionNumber: criterion.number },
        visibility,
        conditionalLogic: gate,
      }));
    });
  });
  return questions;
}

// O-1 (O-1A Extraordinary Ability / O-1B Arts) — mirrors P's variant
// mechanism exactly: ONE shared employer template (visaType stays the
// single "O1"), ONE shared employee template with a variant-gated criteria
// section. "O-1 Classification" (oClassification — same authorized
// addition pattern as P's pClassification) is asked up front in the
// employer checklist and gates the employee checklist's O-1A/O-1B criteria
// via employer_oClassification, exactly like P1A/P1B/P3 gate on
// employer_pClassification.
function buildO1EmployerChecklist() {
  const visibility = { roles: ["employer", ...STAFF_ROLES], portals: ["employer", "admin"] };
  const documentSectionOrder = [];
  const counters = new Map();
  const documentQuestionList = documentQuestions(o1.employerDocuments, visibility, documentSectionOrder, counters);
  const fieldResult = fieldQuestionsFromCatalog(
    o1.fieldCatalog().filter((entry) => entry.section === "employer"),
    visibility,
  );
  // Source order is company/position fields THEN "Documents Required" —
  // fields placed first here, matching P's employer checklist.
  return {
    key: "o1_employer_checklist",
    title: "Employer Checklist for O-1 Visa",
    visaType: "O1",
    checklistRole: "employer",
    isDefault: true,
    description: "",
    sections: [...fieldResult.sectionOrder, ...documentSectionOrder],
    questions: [...fieldResult.questions, ...documentQuestionList],
  };
}

function buildO1EmployeeChecklist() {
  const visibility = { roles: ["employee", ...STAFF_ROLES], portals: ["employee", "admin"] };
  const documentSectionOrder = [];
  const counters = new Map();
  const documentQuestionList = documentQuestions(o1.employeeDocuments, visibility, documentSectionOrder, counters);

  const o1aCriteriaQuestions = o1CriteriaQuestions(o1.O1A_CRITERIA, "O-1A", "O-1A", o1.O1A_CRITERIA_HEADING, visibility, documentSectionOrder, counters);
  const o1bCriteriaQuestions = o1CriteriaQuestions(o1.O1B_CRITERIA, "O-1B", "O-1B", o1.O1B_CRITERIA_HEADING, visibility, documentSectionOrder, counters);

  const fieldResult = fieldQuestionsFromCatalog(
    o1.fieldCatalog().filter((entry) => entry.section === "employee"),
    visibility,
  );
  // Same source order as the employer checklist: "1. Information About YOU"
  // bio fields first, then the 11 shared base documents, then the
  // variant-gated criteria groups (O-1A's 10, then O-1B's 6 — order between
  // the two variant groups is arbitrary since only one is ever visible at a
  // time for a given case).
  return {
    key: "o1_employee_checklist",
    title: "Employee Checklist for O-1 Visa",
    visaType: "O1",
    checklistRole: "employee",
    isDefault: true,
    description: "",
    sections: [...fieldResult.sectionOrder, ...documentSectionOrder],
    questions: [...fieldResult.questions, ...documentQuestionList, ...o1aCriteriaQuestions, ...o1bCriteriaQuestions],
  };
}

const EMPLOYMENT_CHECKLIST_DEFINITIONS = [
  buildH1bEmployerChecklist(),
  buildH1bEmployeeChecklist(),
  buildL1aEmployerChecklist(),
  buildL1aEmployeeChecklist(),
  buildL1aBusinessPlanChecklist(),
  buildPEmployerChecklist(),
  buildPEmployeeChecklist(),
  buildO1EmployerChecklist(),
  buildO1EmployeeChecklist(),
];

module.exports = { EMPLOYMENT_CHECKLIST_DEFINITIONS };
