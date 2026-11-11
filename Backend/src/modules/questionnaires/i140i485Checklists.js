// "I-140 + I-485": an EMPLOYMENT-BASED case type with the employer + employee model (an employer matter, one case per employee) that carries the I-140 AND the I-485 checklists.
//   employer matter : the existing I-140 employer (petitioner) checklist                                      (role employer)
//   each employee   : the existing I-140 employee (beneficiary) checklist + the I-485 Green Card checklist + the I-485 I-864 checklist   (role employee)
// Nothing is re-authored: every question, document and canonical path is the existing one (clones of i140_*_checklist / the family Green Card and I-864 checklists, with the role and
// portal changed). The same canonical paths serve both forms, so a fact the employee gives once (name, date of birth, A-number, SSN, e-mail, last arrival, I-94 ...) fills the I-140
// and the I-485 alike.
//
// The visa type is stored as "I-140/I-485" (shown as "I-140 + I-485"): a "+" would be read as a regex quantifier by the default-checklist lookup (questionnaire.service.js builds
// RegExp(`^${visaType}$`)), which is why a slash is used - the same way "B-1/B-2" and "CR-1/IR-1" are stored.
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("./employmentChecklists");
const { buildFamilyBeneficiaryChecklist, buildFamilySponsorChecklist, withKey } = require("./familyChecklists");
const familyBasedImmigrantPetition = require("../family-workflow/questionnaires/familyBasedImmigrantPetition");

const VISA_TYPE = "I-140/I-485";
const VISA_TYPES = [VISA_TYPE, "I140/I485"]; // the case's visaType is matched with its dashes/spaces stripped, so both spellings are listed
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const employeeVisibility = { roles: ["employee", ...STAFF_ROLES], portals: ["employee", "admin"] };

const existing = (key) => {
  const definition = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((item) => item.key === key);
  if (!definition) throw new Error(`I-140 + I-485 needs the existing checklist ${key}`);
  return definition;
};
const forThisVisa = (definition, key, title) => ({ ...definition, key, title, visaType: VISA_TYPE, visaTypes: VISA_TYPES, isDefault: true });
const asEmployee = (definition) => ({
  ...definition,
  checklistRole: "employee",
  questions: definition.questions.map((question) => ({ ...question, visibility: employeeVisibility })),
});

const I140I485_DEFINITIONS = [
  forThisVisa(existing("i140_petitioner_checklist"), "i140_i485_employer_checklist", "I-140 + I-485 \u2013 Employer Checklist"),
  forThisVisa(existing("i140_beneficiary_checklist"), "i140_i485_employee_checklist", "I-140 + I-485 \u2013 Employee Checklist (I-140)"),
  forThisVisa(asEmployee(buildFamilyBeneficiaryChecklist(withKey(familyBasedImmigrantPetition.greenCard, "green_card_i140i485"), VISA_TYPE, "Green Card Checklist", "Documents Required:")), "i485_green_card_employee_checklist", "I-140 + I-485 \u2013 Employee Checklist (I-485 Green Card)"),
  forThisVisa(asEmployee(buildFamilySponsorChecklist(withKey(familyBasedImmigrantPetition.i864, "i864_i140i485"), VISA_TYPE, "Affidavit of Support (I-864) \u2014 Sponsor/Petitioner and Joint Sponsor", "List of documents from the petitioner:", "Documents Required from Joint Sponsor:")), "i485_i864_employee_checklist", "I-140 + I-485 \u2013 Employee Checklist (I-485 Affidavit of Support, I-864)"),
];

module.exports = { I140I485_DEFINITIONS, I140I485_VISA_TYPE: VISA_TYPE };
