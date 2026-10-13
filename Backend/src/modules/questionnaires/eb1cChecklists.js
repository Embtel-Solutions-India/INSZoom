// EB-1C (Multinational Manager / Executive) - the two Questionnaire templates of the employer-sponsored case:
//   eb1c_employer_checklist  "EB-1C Employer/Petitioner Checklist"   (checklistRole "employer")
//   eb1c_employee_checklist  "EB-1C Employee/Beneficiary Checklist"  (checklistRole "employee")
// Built from the catalog in employment-workflow/questionnaires/eb1c.js (exact labels, ids, canonical targets of the 43 supplied requirements) with
// the same shared builder every other checklist uses. Provisioned exactly like EB-1B's pair: the principal (employer) case gets the employer
// checklist, each employee case the employee checklist; both start as drafts until a case manager approves them (checklist-gate.js).
//
// EVERYTHING here is optional. A question flagged metadata.optional never blocks Submit (questionnaire.service.js), and every question is stored
// required:false, so a client can save or submit with every answer blank. Gated questions (the spouse / children documents) simply are not shown
// until the matching optional answer says they apply; an unanswered "does the beneficiary have a spouse?" is "unknown", never "no".

const { buildQuestion } = require("./definitionHelpers");
const eb1c = require("../employment-workflow/questionnaires/eb1c");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const URL_RULE = { type: "regex", value: "^https?://[^\\s/$.?#][^\\s]*\\.[^\\s]{2,}$", message: "Enter a full web address, for example https://www.example.com", severity: "error" };
const PERCENT_RULES = [
  { type: "min", value: 0, message: "A percentage must be between 0 and 100", severity: "error" },
  { type: "max", value: 100, message: "A percentage must be between 0 and 100", severity: "error" },
];
const YES = "Yes";

const gate = (...rules) => ({ mode: "all", rules, groups: [] });
const eq = (questionKey, value) => ({ questionKey, operator: "equals", value });
const gte = (questionKey, value) => ({ questionKey, operator: "gte", value });

// One question from a catalog entry (a document upload or a website URL).
function fromItem(definition, section, order, visibility, extras = {}) {
  const isUrl = definition.type === "url";
  const type = isUrl ? "text" : "file";
  const documentType = eb1c.documentType(definition);
  return buildQuestion(documentType, definition.label, type, section, order, {
    required: false,
    description: extras.description,
    evidenceCategory: isUrl ? undefined : definition.category,
    mapping: { canonicalPath: definition.canonical },
    ...(isUrl ? { validationRules: [URL_RULE] } : {}),
    conditionalLogic: extras.conditionalLogic,
    metadata: {
      ...(isUrl ? { format: "url" } : { documentType, category: definition.category }),
      itemNumber: definition.no,
      requirement: "optional",
      optional: true,
      ...(definition.groupId ? { groupId: definition.groupId } : {}),
      ...(extras.metadata || {}),
    },
    visibility,
  });
}

function buildEmployerChecklist() {
  const visibility = { roles: ["employer", ...STAFF_ROLES], portals: ["employer", "admin"] };
  const sections = [eb1c.EMPLOYER_SECTIONS.us, eb1c.EMPLOYER_SECTIONS.foreign, eb1c.EMPLOYER_SECTIONS.relationship];
  const counters = new Map();
  const questions = eb1c.EMPLOYER_ITEMS.map((definition) => {
    const section = eb1c.EMPLOYER_SECTIONS[definition.section];
    const order = (counters.get(section) || 0) + 1;
    counters.set(section, order);
    return fromItem(definition, section, order, visibility);
  });
  return {
    key: "eb1c_employer_checklist",
    title: "EB-1C Employer/Petitioner Checklist",
    visaType: "EB1C",
    checklistRole: "employer",
    isDefault: true,
    description: "Optional supporting documents for the U.S. petitioner, the related foreign company, and the qualifying relationship between them. Upload what you have; nothing here is required.",
    sections,
    questions,
  };
}

function buildEmployeeChecklist() {
  const visibility = { roles: ["employee", ...STAFF_ROLES], portals: ["employee", "admin"] };
  const employment = eb1c.EMPLOYEE_SECTIONS.employment;
  const family = eb1c.EMPLOYEE_SECTIONS.family;
  const questions = [];
  let order = 0;
  const addEmployment = (question) => questions.push({ ...question, order: (order += 1) });

  eb1c.EMPLOYEE_ITEMS.forEach((definition) => {
    addEmployment(fromItem(definition, employment, 0, visibility));
    // Item 29 asks for the duties WITH percentage allocation: the upload stays the primary answer, and the same section carries the four
    // optional structured percentages (never inferred from the upload, never required).
    if (definition.no === "29") {
      eb1c.DUTY_PERCENTAGES.forEach((duty) => addEmployment(buildQuestion(`eb1c_${duty.id}`, duty.label, "number", employment, 0, {
        required: false,
        mapping: { canonicalPath: duty.canonical },
        validationRules: PERCENT_RULES,
        metadata: {
          requirement: "optional", optional: true, canonicalType: "number 0-100", itemNumber: "29",
          // when ALL four are answered they must add up to 100 (checked by validateResponse; a partial set is never judged)
          sumGroup: { id: "eb1c_duties", total: 100, label: "The four duty percentages" },
        },
        visibility,
      })));
    }
  });

  // Family: two optional applicability answers, then the conditional documents.
  let familyOrder = 0;
  const addFamily = (question) => questions.push({ ...question, order: (familyOrder += 1) });
  const spouseKey = `eb1c_${eb1c.FAMILY.hasSpouse.id}`;
  const childrenKey = `eb1c_${eb1c.FAMILY.hasChildren.id}`;
  const countKey = `eb1c_${eb1c.FAMILY.childCount.id}`;
  addFamily(buildQuestion(spouseKey, eb1c.FAMILY.hasSpouse.label, "boolean", family, 0, {
    required: false, mapping: { canonicalPath: eb1c.FAMILY.hasSpouse.canonical }, metadata: { requirement: "optional", optional: true, canonicalType: "boolean (unanswered = unknown)" }, visibility,
  }));
  addFamily(buildQuestion(childrenKey, eb1c.FAMILY.hasChildren.label, "boolean", family, 0, {
    required: false, mapping: { canonicalPath: eb1c.FAMILY.hasChildren.canonical }, metadata: { requirement: "optional", optional: true, canonicalType: "boolean (unanswered = unknown)" }, visibility,
  }));
  addFamily(buildQuestion(countKey, eb1c.FAMILY.childCount.label, "number", family, 0, {
    required: false, description: "Used only to show one document set per child.",
    mapping: { canonicalPath: eb1c.FAMILY.childCount.canonical },
    validationRules: [{ type: "min", value: 1, message: "Enter at least 1", severity: "error" }, { type: "max", value: eb1c.MAX_CHILD_RECORDS, message: `Up to ${eb1c.MAX_CHILD_RECORDS} children can be entered here - tell your case manager if you have more`, severity: "error" }],
    conditionalLogic: gate(eq(childrenKey, YES)),
    metadata: { requirement: "optional", optional: true, canonicalType: "integer" }, visibility,
  }));
  eb1c.SPOUSE_ITEMS.forEach((definition) => addFamily(fromItem(definition, family, 0, visibility, { conditionalLogic: gate(eq(spouseKey, YES)) })));

  // One numbered record per child; each has its own uploads. Child 1 shows once "has children" is Yes; child N (N >= 2) once the count reaches N.
  const childSections = [];
  eb1c.childRecords().forEach((childNumber) => {
    const section = `Child ${childNumber} Documents`;
    childSections.push(section);
    const conditionalLogic = childNumber === 1 ? gate(eq(childrenKey, YES)) : gate(eq(childrenKey, YES), gte(countKey, childNumber));
    let childOrder = 0;
    eb1c.childDocuments().filter((definition) => definition.childNumber === childNumber).forEach((definition) => {
      questions.push({ ...fromItem(definition, section, (childOrder += 1), visibility, { conditionalLogic, metadata: { childNumber, dependent: "child" } }) });
    });
  });

  return {
    key: "eb1c_employee_checklist",
    title: "EB-1C Employee/Beneficiary Checklist",
    visaType: "EB1C",
    checklistRole: "employee",
    isDefault: true,
    description: "Optional supporting documents for the beneficiary, and for a spouse and children if there are any. Upload what you have; nothing here is required.",
    sections: [employment, family, ...childSections],
    questions,
  };
}

const EB1C_CHECKLIST_DEFINITIONS = [buildEmployerChecklist(), buildEmployeeChecklist()];

module.exports = { EB1C_CHECKLIST_DEFINITIONS, buildEmployerChecklist, buildEmployeeChecklist };
