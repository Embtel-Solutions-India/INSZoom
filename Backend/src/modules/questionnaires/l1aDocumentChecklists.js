// L1A Documentation Checklist - the ONE checklist an L-1A / L-1A Extension case now gets in place of the old L-1A Employer + Employee pair (those stay in the database for the cases
// that already carry them, but are no longer assigned to new cases). Companion of the existing L-1A Business Plan checklist, which is unchanged.
//   l1a_document_checklist     "L1A Documentation Checklist"            (checklistRole "employer", visa L-1A)
//   l1aext_document_checklist  "L1A Extension Documentation Checklist"  (checklistRole "employer", visa L-1A Extension)
// It is attached to the employer matter and filled there (the employer, or staff for them). Three sections - Documents from the U.S. Company (11 questions), Documents from the Foreign
// (outside U.S.) Company (16) and Documents Pertaining to Beneficiary, Spouse and Child (4) - 31 questions, every one required, numbered within its section. Uploads are the app's normal
// upload question (several files per question, up to 10, as everywhere else); the website questions are short answers; the managerial duties is a long answer.
// Document keys that already existed in the old checklists are reused unchanged (same document types, same evidence categories), so everything that reads a case's documents keeps working.
// Provisioned and gated exactly like every other checklist: it starts as a draft until a case manager approves it (checklist-gate.js), and it is listed on the Questionnaire page.
// `settings.inlineDocuments` keeps the uploads inside their own three sections (instead of the shared "Documents" step the other checklists use), so exactly these three sections show.

const { buildQuestion } = require("./definitionHelpers");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const L1A_VISA_TYPES = ["L1A", "L-1A"];
const L1A_EXTENSION_VISA_TYPES = ["L1AEXTENSION", "L-1A Extension"];

const SECTIONS = {
  us: "Documents from the U.S. Company",
  foreign: "Documents from the Foreign (outside U.S.) Company",
  beneficiary: "Documents Pertaining to Beneficiary, Spouse and Child",
};

// Description text is plain text with line breaks: "• " lines are a bullet list, "1. " lines a numbered list (the checklist screens keep the line breaks).
const PREMISES_DESCRIPTION = [
  "Please provide photographs of the business premises, both inside and outside. The photographs should show:",
  "• Company name and logo.",
  "• Business address.",
  "• Personnel at work.",
  "• Major work areas.",
].join("\n");

// kind "url": a website address (short answer with a web-address check); kind "long": a long answer; everything else is an upload. `cat` is the evidence category.
const ITEMS = {
  us: [
    { key: "us_articles_of_incorporation", title: "Articles of Incorporation", cat: "us_business" },
    { key: "ein_assignment_letter", title: "EIN Assignment Letter by the Internal Revenue Service", cat: "us_business" },
    { key: "us_business_license", title: "Business License", cat: "us_business" },
    { key: "us_lease_agreement", title: "Lease", cat: "us_business" },
    { key: "us_business_premises_photographs", title: "Photographs of Business Premises", description: PREMISES_DESCRIPTION, cat: "us_business" },
    { key: "us_company_website", title: "Company Website", kind: "url", cat: "us_business" },
    { key: "us_company_brochure", title: "Brochure", cat: "us_business" },
    { key: "us_commercial_transaction_documents", title: "Commercial Contracts and Business Transaction Documents", description: "Please provide relevant commercial contracts, invoices, bills of lading, letters of credit, and other applicable business transaction documents.", cat: "us_business" },
    { key: "us_bank_statements", title: "Last Three Months' Bank Statements", cat: "us_business" },
    { key: "us_beneficiary_duties_letter", title: "Letter from an Authorized Representative of the U.S. Entity Describing the Beneficiary's Expected Duties", description: "Provide a letter from an authorized representative of the U.S. entity describing the beneficiary's expected duties. The letter should specify the duties performed by each subordinate staff member that will relieve the beneficiary from performing operational tasks, allowing the beneficiary to focus on managerial or executive work.", cat: "us_business" },
    { key: "us_company_letterhead", title: "Letterhead in Microsoft Word Format", cat: "us_business" },
  ],
  foreign: [
    { key: "foreign_business_registration", title: "Business Registration Documents", cat: "foreign_business" },
    { key: "foreign_lease_agreement", title: "Lease", cat: "foreign_business" },
    { key: "foreign_business_premises_photographs", title: "Photographs of Business Premises", description: PREMISES_DESCRIPTION, cat: "foreign_business" },
    { key: "foreign_company_website", title: "Company Website", kind: "url", cat: "foreign_business" },
    { key: "foreign_company_brochure", title: "Brochure", cat: "foreign_business" },
    { key: "foreign_business_transaction_documents", title: "Documents of Business Transactions", description: "Please provide relevant business transaction documents, including contracts, bills of lading, letters of credit, and other applicable records.", cat: "foreign_business" },
    { key: "foreign_tax_returns", title: "Tax Return for the Latest Year", cat: "foreign_business" },
    { key: "foreign_bank_statements", title: "Last Three Months' Bank Statements", cat: "foreign_business" },
    { key: "us_foreign_relationship_evidence", title: "Documents Showing the Relationship Between the U.S. and Foreign Companies", cat: "foreign_business" },
    { key: "beneficiary_offer_letter", title: "Offer Letter", cat: "foreign_business" },
    { key: "beneficiary_foreign_pay_stubs", title: "Pay Stubs for a Continuous Year", description: "Please provide pay stubs covering one continuous year.", cat: "foreign_business" },
    { key: "minutes_dispatching_beneficiary", title: "Extract from the Minutes of the Meeting of the Directors or Other Official Documentation Regarding Dispatching the Beneficiary to the U.S.", description: "Provide an extract from the minutes of the meeting of the directors or other official documentation regarding the dispatch of the beneficiary to the U.S. for management purposes at the U.S. entity.", cat: "foreign_business" },
    // Items 13 and 14 each have four parts. They are ONE question each, and the four parts are written inside the question itself, one per line as a, b, c, d (so every screen that shows the question shows them).
    {
      key: "employer_foreignCompany_managerialDuties",
      title: "Detailed Managerial Duties at foreign entity as per following sections and % of each:",
      kind: "long",
      subparts: [
        "Manages a corporation, department, subdivision, or function.",
        "Supervises and controls the work of other supervisory, professional, or managerial employees, or else manages essential functions.",
        "Has the authority to make personal decisions as to hiring and termination, or else function at a senior level, or",
        "Exercises discretion over the day to day operations of the activity or function for which he or she has authority.",
      ],
      description: "Write what the beneficiary does under each part and the percentage of time spent on it.",
      cat: "foreign_business",
    },
    {
      key: "beneficiary_correspondence_evidence",
      title: "Copies of emails, memos, letters and other such dispatches from beneficiary (in a foreign country) that show:",
      subparts: [
        "Beneficiary supervising and controlling the work of the subordinate staff in the organizational chart.",
        "Beneficiary hiring and firing and recommending personal actions.",
        "Beneficiary issuing orders regarding day-to-day operations (of subordinate staff).",
        "Performance reviews by beneficiary for the subordinate staff for one continuous year.",
      ],
      description: "Upload what applies to all four parts here - as many files as you need.",
      cat: "foreign_business",
    },
    { key: "subordinate_employees_resumes_degrees", title: "Subordinate Employees' Resumes and Degree Certificates", cat: "foreign_business" },
    { key: "foreign_company_letterhead", title: "Letterhead in Microsoft Word Format", cat: "foreign_business" },
  ],
  beneficiary: [
    { key: "foreign_employment_verification_letter", title: "Employment Verification Letter from the Foreign Company's HR Department", cat: "employment" },
    { key: "academic_certificates", title: "Academic Certificate and Transcripts", cat: "education" },
    { key: "updated_resume", title: "Resume of Beneficiary", cat: "employment" },
    { key: "passport", title: "Passports of Beneficiaries", description: "Provide passport copies for the beneficiary, spouse, and child, as applicable.", cat: "identity" },
  ],
};

const LETTERS = ["a", "b", "c", "d", "e", "f"];

// a web address with or without http(s)://
const WEBSITE_RULE = { type: "regex", value: "^(https?://)?[^\\s/$.?#][^\\s]*\\.[^\\s]{2,}$", message: "Enter the website address, for example www.example.com", severity: "error" };

function buildDocumentChecklist({ key, title, visaType, visaTypes, description }) {
  const visibility = { roles: ["employer", ...STAFF_ROLES], portals: ["employer", "admin"] };
  const questions = [];
  let order = 0; // one running number across the whole checklist (the three sections follow each other)
  for (const [sectionName, sectionTitle] of Object.entries(SECTIONS)) {
    ITEMS[sectionName].forEach((item, index) => {
      // numbered within its section; the parts of an item with parts follow on their own lines, indented, as a, b, c, d
      const label = `${index + 1}. ${item.title}${(item.subparts || []).map((part, partIndex) => `\n    ${LETTERS[partIndex]}. ${part}`).join("")}`;
      const base = { required: true, description: item.description, visibility };
      if (item.kind === "url") {
        questions.push(buildQuestion(item.key, label, "text", sectionTitle, (order += 1), { ...base, validationRules: [WEBSITE_RULE], metadata: { format: "url", itemNumber: index + 1 } }));
      } else if (item.kind === "long") {
        questions.push(buildQuestion(item.key, label, "textarea", sectionTitle, (order += 1), { ...base, metadata: { itemNumber: index + 1 } }));
      } else {
        questions.push(buildQuestion(item.key, label, "file", sectionTitle, (order += 1), { ...base, evidenceCategory: item.cat, metadata: { documentType: item.key, category: item.cat, itemNumber: index + 1 } }));
      }
    });
  }
  return {
    key,
    title,
    visaType,
    visaTypes,
    checklistRole: "employer",
    isDefault: true,
    // brings the title / visa / role of an already-created template of this key up to date (the first version of this checklist was created under a different title)
    reconcileMetadata: true,
    settings: { inlineDocuments: true },
    description,
    sections: Object.values(SECTIONS),
    questions,
  };
}

const DESCRIPTION = "Supporting documents and information for an L-1A petition: the U.S. company, the foreign company, and the beneficiary with spouse and children.";

const L1A_DOCUMENT_CHECKLIST_DEFINITIONS = [
  buildDocumentChecklist({ key: "l1a_document_checklist", title: "L1A Documentation Checklist", visaType: "L1A", visaTypes: L1A_VISA_TYPES, description: DESCRIPTION }),
  buildDocumentChecklist({ key: "l1aext_document_checklist", title: "L1A Extension Documentation Checklist", visaType: "L1AEXTENSION", visaTypes: L1A_EXTENSION_VISA_TYPES, description: DESCRIPTION.replace("L-1A petition", "L-1A Extension petition") }),
];

// The old L-1A / L-1A Extension Employer and Employee checklists. Retired: they must never be assigned to a case again (a case that ALREADY carries one keeps it).
const RETIRED_L1A_CHECKLIST_KEYS = Object.freeze(["l1a_employer_checklist", "l1a_employee_checklist", "l1aext_employer_checklist", "l1aext_employee_checklist"]);

const NEW_DOCUMENT_CHECKLIST_KEYS = Object.freeze(L1A_DOCUMENT_CHECKLIST_DEFINITIONS.map((definition) => definition.key));
// matches a retired checklist and the per-case copy of one (key + "__case_<caseId>") that a case manager made by editing it
const RETIRED_KEY_PATTERN = /^(l1a|l1aext)_(employer|employee)_checklist(__case_[a-f0-9]+)?$/;

/**
 * A "legacy" L-1A case already carries one of the retired employer / employee checklists. It stays exactly as it is: it keeps that checklist with all its answers and is NEVER given the new
 * document checklist on top. Every other L-1A / L-1A Extension case gets only the new one. Works on a stored case or an in-memory one (reads its questionnaireReferences). Never throws.
 */
async function carriesRetiredL1aChecklist(caseLike) {
  try {
    const ids = [...new Set((caseLike?.questionnaireReferences || []).flatMap((reference) => [reference.questionnaireTemplateId, reference.questionnaireId]).filter(Boolean).map(String))];
    if (!ids.length) return false;
    const Questionnaire = require("../../models/Questionnaire");
    return Boolean(await Questionnaire.exists({ _id: { $in: ids }, key: RETIRED_KEY_PATTERN }));
  } catch (_error) {
    return false;
  }
}

module.exports = { L1A_DOCUMENT_CHECKLIST_DEFINITIONS, RETIRED_L1A_CHECKLIST_KEYS, NEW_DOCUMENT_CHECKLIST_KEYS, RETIRED_KEY_PATTERN, carriesRetiredL1aChecklist };
