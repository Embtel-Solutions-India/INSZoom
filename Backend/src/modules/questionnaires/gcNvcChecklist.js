// GC-NVC (Green Card - National Visa Center / DS-260) - the standalone case type's Information Checklist.
//
// ONE client questionnaire, key "gc_nvc_checklist", provisioned at case creation by the same default-assignment path every
// other no-form case type uses (isDefault + visaType "GCNVC" + checklistRole "client") - exactly like PERM. A GC-NVC case carries
// NO USCIS forms and no CaseForm rows (config/visaCategories.js noForms). New cases start with the checklist as a DRAFT on the
// Case Manager's side (the existing checklist approval gate: Case.checklistApproval); approving it releases it to the client,
// who answers and saves through the ordinary questionnaire/answer pipeline, and Admin reads the same Answer rows.
//
// This is NOT a second questionnaire system and NOT a copy of the per-family-visa "gc_nvc_<visa>_beneficiary_checklist" that
// the family workflow offers inside a consular family case. It re-uses that module's two pieces of source-of-truth content - the
// 53 verbatim Part 11 security questions and the six document requirements - so their wording lives in exactly one place, and
// lays them out as the approved GC-NVC checklist (13 parts, conditional questions, repeatable groups, per-question explanations).
//
// Question key = "gc_nvc_" + snake_case name. Required means "required whenever the question is shown": every conditional
// question carries conditionalLogic, so it is never required while hidden.

const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");
const { GC_NVC_SECURITY_QUESTIONS, gcNvcDocuments } = require("../family-workflow/questionnaires/familyBasedImmigrantPetition");

const CHECKLIST_KEY = "gc_nvc_checklist";
// Case.visaType "GC-NVC" normalises to this (dashes/spaces stripped, upper-cased) - see resolveCaseQuestionnaires.
const GC_NVC_VISA_TYPES = ["GCNVC"];
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const COUNTRY_OPTIONS = COUNTRIES.map((value) => (typeof value === "object" ? value : { label: value, value }));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((value) => ({ label: value, value }));
const MONTH_YEAR_RULE = [{ type: "regex", value: "^(0[1-9]|1[0-2])\\/(19|20)\\d{2}$", message: "Enter the month and year as MM/YYYY, for example 06/2019." }];
const YEAR_RULE = [{ type: "regex", value: "^(19|20)\\d{2}$", message: "Enter a 4-digit year, for example 2012." }];

const P1 = "Part 1: Personal Information of Applicant";
const P2 = "Part 2: Address History";
const P3 = "Part 3: Contact History";
const P4 = "Part 4: Parents";
const P5 = "Part 5: Spouse Information";
const P6 = "Part 6: Children";
const P7 = "Part 7: Previous U.S. Travel";
const P8 = "Part 8: Employment Information";
const P9 = "Part 9: Educational Information";
const P10 = "Part 10: Additional Information";
const P11 = "Part 11: Security and Background";
const P12 = "Part 12: Social Security Number";
const P13 = "Part 13: Petitioner Information";
const DOCS = "Required Documents";
const SECTIONS = [P1, P2, P3, P4, P5, P6, P7, P8, P9, P10, P11, P12, P13, DOCS];

const key = (name) => `gc_nvc_${name}`;
const rule = (name, value, operator = "equals") => ({ questionKey: key(name), operator, value });
const when = (...rules) => ({ mode: "all", rules, groups: [] });
const whenAny = (...rules) => ({ mode: "any", rules, groups: [] });
const yes = (name) => when(rule(name, "Yes"));
const no = (name) => when(rule(name, "No"));
const married = rule("marital_status", "Married");

// ── spec rows -> Questions ───────────────────────────────────────────────
// [section, name, label, type, required, extras]  (extras: options, cond, description, rules, map, number)
const FIELD = (section, name, label, type, required, extras = {}) => ({ section, name, label, type, required, ...extras });
const text = (section, name, label, required = true, extras) => FIELD(section, name, label, "text", required, extras);
const longText = (section, name, label, required = true, extras) => FIELD(section, name, label, "textarea", required, extras);
const date = (section, name, label, required = true, extras) => FIELD(section, name, label, "date", required, extras);
const phone = (section, name, label, required = true, extras) => FIELD(section, name, label, "phone", required, extras);
const email = (section, name, label, required = true, extras) => FIELD(section, name, label, "email", required, extras);
const country = (section, name, label, required = true, extras) => FIELD(section, name, label, "select", required, { options: COUNTRY_OPTIONS, ...extras });
const yesNo = (section, name, label, required = true, extras) => FIELD(section, name, label, "radio", required, { options: YES_NO, ...extras });
const address = (section, name, label, required = true, extras) => FIELD(section, name, label, "address", required, extras);
const monthYear = (section, name, label, required = true, extras) => FIELD(section, name, label, "text", required, { rules: MONTH_YEAR_RULE, description: "Enter as MM/YYYY.", ...extras });
const location = (section, name, label, required = true, extras) => FIELD(section, name, label, "text", required, { description: "City, State/Province and Country.", ...extras });
const group = (section, name, label, required, groupConfig, extras) => FIELD(section, name, label, "repeating_group", required, { group: groupConfig, ...extras });

const col = (columnKey, label, type = "text", extras = {}) => ({ key: columnKey, label, type, required: true, ...extras });
const countryCol = (columnKey, label) => col(columnKey, label, "select", { options: COUNTRY_OPTIONS });
const monthCol = (columnKey, label) => col(columnKey, label, "select", { options: MONTHS });
const yearCol = (columnKey, label) => col(columnKey, label, "number", { min: 1900, max: 2100, step: "1" });
const yesNoCol = (columnKey, label) => col(columnKey, label, "select", { options: YES_NO });

const SPECS = [
  // Part 1
  text(P1, "first_name", "First Name as per passport", true, { map: "person.firstName" }),
  text(P1, "last_name", "Last Name as per passport", true, { map: "person.lastName" }),
  text(P1, "other_names", "Other Names Used (if any)", false),
  FIELD(P1, "sex", "Sex", "select", true, { options: ["Male", "Female"] }),
  date(P1, "date_of_birth", "Date of Birth", true, { map: "person.dob" }),
  FIELD(P1, "marital_status", "Current Marital Status", "select", true, { options: ["Single", "Married", "Divorced", "Widowed", "Annulled", "Separated"] }),
  text(P1, "city_of_birth", "City of Birth"),
  text(P1, "state_of_birth", "State/Province of Birth"),
  country(P1, "country_of_birth", "Country of Birth", true, { map: "person.countryOfBirth" }),
  country(P1, "country_of_citizenship", "Country of Citizenship", true, { map: "person.citizenship" }),
  yesNo(P1, "has_other_nationality", "Do you hold or have you held any nationality other than the one you have indicated above?"),
  country(P1, "other_nationality_country", "If Yes, Country Name", true, { cond: yes("has_other_nationality") }),
  text(P1, "other_nationality_passport_number", "If Yes, Passport Number", true, { cond: yes("has_other_nationality") }),
  text(P1, "passport_number", "Current Passport Number"),
  date(P1, "passport_issuance_date", "Passport Issuance Date"),
  date(P1, "passport_expiry_date", "Passport Expiry Date"),
  country(P1, "passport_issuing_country", "Country that issued the Passport"),

  // Part 2
  text(P2, "present_street", "Present Street Address"),
  text(P2, "present_city", "Present City"),
  text(P2, "present_state", "Present State/Province"),
  text(P2, "present_zip", "Present Postal Zone/ZIP Code"),
  country(P2, "present_country", "Present Country/Region"),
  monthYear(P2, "present_address_start", "Start Date of Living at Present Address (Month and Year)"),
  yesNo(P2, "mailing_differs", "Is Mailing Address different from Present Address?"),
  text(P2, "mailing_street", "Mailing Street Number and Name", true, { cond: yes("mailing_differs") }),
  text(P2, "mailing_city", "Mailing City", true, { cond: yes("mailing_differs") }),
  text(P2, "mailing_state", "Mailing State/Province", true, { cond: yes("mailing_differs") }),
  text(P2, "mailing_zip", "Mailing Postal Zone/ZIP Code", true, { cond: yes("mailing_differs") }),
  country(P2, "mailing_country", "Mailing Country/Region", true, { cond: yes("mailing_differs") }),
  group(P2, "address_history", "Address History Since Age 16", true, {
    itemLabel: "Address", addLabel: "+ Add Address", summaryFields: ["street_and_number", "city"],
    columns: [col("street_and_number", "Street and Number"), col("city", "City"), col("province_state", "Province/State"), countryCol("country", "Country"),
      monthCol("from_month", "From Month"), yearCol("from_year", "From Year"), monthCol("to_month", "To Month"), yearCol("to_year", "To Year")],
  }),
  text(P2, "us_contact_name", "Name of Person Currently Living at U.S. Address, if known", false),
  text(P2, "us_street", "U.S. Street Number and Name"),
  text(P2, "us_city", "U.S. City"),
  text(P2, "us_state", "U.S. State"),
  text(P2, "us_zip", "U.S. Postal Zone/ZIP Code"),
  phone(P2, "us_phone", "U.S. Phone Number, if known", false),
  yesNo(P2, "delivery_differs", "Is Green Card Delivery Address different from the above U.S. address?"),
  text(P2, "delivery_contact", "Green Card Delivery Contact Person", true, { cond: yes("delivery_differs") }),
  text(P2, "delivery_address", "Delivery Address", true, { cond: yes("delivery_differs") }),
  text(P2, "delivery_city", "Delivery City", true, { cond: yes("delivery_differs") }),
  text(P2, "delivery_state", "Delivery State", true, { cond: yes("delivery_differs") }),
  text(P2, "delivery_zip", "Delivery ZIP Code", true, { cond: yes("delivery_differs") }),
  phone(P2, "delivery_phone", "Delivery Phone Number, if known", false, { cond: yes("delivery_differs") }),

  // Part 3
  phone(P3, "primary_phone", "Primary Phone Number", true, { map: "contact.phone" }),
  phone(P3, "secondary_phone", "Secondary Phone Number", false),
  phone(P3, "work_phone", "Work Phone Number", false),
  yesNo(P3, "has_other_phones", "Have you used any other telephone numbers during the last 5 years?"),
  group(P3, "other_phones", "If Yes, provide all telephone numbers used", true, {
    itemLabel: "Telephone number", addLabel: "+ Add Telephone Number", summaryFields: ["phone_number"], columns: [col("phone_number", "Telephone Number", "phone")],
  }, { cond: yes("has_other_phones") }),
  email(P3, "current_email", "Current Email Address"),
  yesNo(P3, "has_other_emails", "Have you used any other email addresses during the last 5 years?"),
  group(P3, "other_emails", "If Yes, provide all email addresses used", true, {
    itemLabel: "Email address", addLabel: "+ Add Email Address", summaryFields: ["email_address"], columns: [col("email_address", "Email Address", "text")],
  }, { cond: yes("has_other_emails") }),
  group(P3, "social_media", "Social Media Platforms Used Within Last 5 Years", true, {
    itemLabel: "Platform", addLabel: "+ Add Platform", summaryFields: ["platform", "identifier"],
    instructions: ["If you have not used any social media platform, choose None as the Provider/Platform."],
    columns: [
      col("platform", "Provider/Platform", "combo", { options: ["None", "Facebook", "Instagram", "X (Twitter)", "LinkedIn", "YouTube", "TikTok", "Snapchat", "WhatsApp", "Telegram", "Reddit", "Pinterest"] }),
      col("identifier", "Identifier", "text", { hiddenWhen: { field: "platform", equals: "None" }, requiredUnless: { field: "platform", equals: "None" } }),
    ],
  }),

  // Part 4
  text(P4, "father_last_name", "Father's Last Name"),
  text(P4, "father_first_name", "Father's First Name"),
  date(P4, "father_dob", "Father's Date of Birth"),
  location(P4, "father_birth_place", "Father's City, State & Country of Birth"),
  yesNo(P4, "father_living", "Is your father still living?"),
  address(P4, "father_address", "If Yes, Father's Full Address", true, { cond: yes("father_living") }),
  FIELD(P4, "father_year_of_death", "If No, Year of Death", "text", true, { cond: no("father_living"), rules: YEAR_RULE, description: "Enter a 4-digit year." }),
  text(P4, "mother_last_name", "Mother's Last Name"),
  text(P4, "mother_first_name", "Mother's First Name"),
  date(P4, "mother_dob", "Mother's Date of Birth"),
  location(P4, "mother_birth_place", "Mother's City, State & Country of Birth"),
  yesNo(P4, "mother_living", "Is your mother still living?"),
  address(P4, "mother_address", "If Yes, Mother's Full Address", true, { cond: yes("mother_living") }),
  FIELD(P4, "mother_year_of_death", "If No, Year of Death", "text", true, { cond: no("mother_living"), rules: YEAR_RULE, description: "Enter a 4-digit year." }),

  // Part 5 - the spouse block applies to an applicant who is currently married
  text(P5, "spouse_last_name", "Current Spouse's Last Name", true, { cond: when(married) }),
  text(P5, "spouse_first_name", "Current Spouse's First Name", true, { cond: when(married) }),
  date(P5, "spouse_dob", "Current Spouse's Date of Birth", true, { cond: when(married) }),
  location(P5, "spouse_birth_place", "Current Spouse's City, State & Country of Birth", true, { cond: when(married) }),
  address(P5, "spouse_address", "Current Spouse's Address", true, { cond: when(married) }),
  text(P5, "spouse_occupation", "Current Spouse's Occupation", true, { cond: when(married) }),
  longText(P5, "spouse_support_explanation", "If Not Employed, Explain Who Supports Spouse", false, { cond: when(married), description: "Complete only if your spouse is not employed." }),
  date(P5, "marriage_date", "Date of Marriage", true, { cond: when(married) }),
  location(P5, "marriage_place", "City, State & Country of Marriage", true, { cond: when(married) }),
  yesNo(P5, "spouse_immigrating_with", "Is your spouse immigrating with you?", true, { cond: when(married) }),
  yesNo(P5, "spouse_immigrating_later", "If No, Is your spouse immigrating to the U.S. at a later date to join you?", true, { cond: when(married, rule("spouse_immigrating_with", "No")) }),
  FIELD(P5, "previous_spouse_count", "Number of Previous Spouses", "number", false, { rules: [{ type: "min", value: 0, message: "Number of previous spouses cannot be negative." }] }),
  group(P5, "previous_spouses", "Previous Spouse Information", true, {
    itemLabel: "Previous spouse", addLabel: "+ Add Previous Spouse", summaryFields: ["full_name"],
    columns: [col("full_name", "Full Name"), col("date_of_birth", "Date of Birth", "date"), col("date_of_marriage", "Date of Marriage", "date"),
      col("marriage_place", "City, State & Country of Marriage"), col("date_marriage_ended", "Date Marriage Legally Ended", "date"), col("marriage_ended_place", "City, State & Country Where Marriage Ended")],
  }, { cond: when(rule("previous_spouse_count", 0, "gt")) }),

  // Part 6
  yesNo(P6, "has_children", "Do you have any children?"),
  FIELD(P6, "children_count", "Number of Children", "number", true, { cond: yes("has_children"), rules: [{ type: "min", value: 1, message: "Enter at least 1." }] }),
  group(P6, "children", "Children Information", true, {
    itemLabel: "Child", addLabel: "+ Add Child", summaryFields: ["first_name", "last_name"],
    columns: [col("last_name", "Last Name"), col("first_name", "First Name"), col("date_of_birth", "Date of Birth", "date"), col("birth_place", "City, State and Country of Birth"),
      col("present_address", "Full Present Address"), yesNoCol("immigrating_with_you", "Is this child immigrating to the U.S. with you?"), yesNoCol("immigrating_later", "Is this child immigrating to the U.S. at a later date to join you?")],
  }, { cond: yes("has_children") }),

  // Part 7
  yesNo(P7, "been_to_us", "Have you ever been in the U.S.?"),
  yesNo(P7, "alien_number_issued", "Were you issued an Alien Registration Number?", true, { cond: yes("been_to_us") }),
  text(P7, "alien_number", "Alien Registration Number", true, { cond: when(rule("been_to_us", "Yes"), rule("alien_number_issued", "Yes")), map: "person.alienNumber" }),
  group(P7, "us_visits", "Last Five U.S. Visits", true, {
    itemLabel: "Visit", addLabel: "+ Add Visit", max: 5, summaryFields: ["date_arrived"],
    columns: [col("date_arrived", "Date Arrived", "date"), col("length_of_stay", "Length of Stay")],
  }, { cond: yes("been_to_us") }),
  yesNo(P7, "ever_issued_visa", "Have you ever been issued a U.S. Visa?"),
  date(P7, "visa_issued_date", "Date Visa Was Issued", true, { cond: yes("ever_issued_visa") }),
  text(P7, "visa_classification", "Visa Classification", false, { cond: yes("ever_issued_visa") }),
  text(P7, "visa_number", "Visa Number", false, { cond: yes("ever_issued_visa") }),
  yesNo(P7, "visa_lost_or_stolen", "Have any of your U.S. visas ever been lost or stolen?", true, { cond: yes("ever_issued_visa") }),
  yesNo(P7, "visa_cancelled_or_revoked", "Have any of your U.S. visas ever been cancelled or revoked?", true, { cond: yes("ever_issued_visa") }),
  yesNo(P7, "refused_visa_or_admission", "Have you ever been refused a U.S. visa, refused admission to the U.S., or withdrawn your application for admission at the port of entry?"),

  // Part 8
  text(P8, "primary_occupation", "Primary Occupation Title"),
  longText(P8, "primary_not_employed_support", "If Not Employed, Explain How You Are Supporting Yourself", false, { description: "Complete only if you are not employed." }),
  yesNo(P8, "has_other_occupations", "Do you have any other occupations?"),
  group(P8, "other_occupations", "Other Occupations", true, {
    itemLabel: "Occupation", addLabel: "+ Add Occupation", summaryFields: ["occupation_title", "employer_name"],
    columns: [col("occupation_title", "Other Occupation Title"), col("employer_name", "Other Employer or School Name"), col("street_address", "Street Address"), col("city", "City"),
      col("state_province", "State/Province"), col("postal_code", "Postal Zone/ZIP Code"), countryCol("country", "Country/Region"), col("telephone", "Telephone Number", "phone")],
  }, { cond: yes("has_other_occupations") }),
  text(P8, "intended_us_occupation", "Occupation Title You Intend to Work in the U.S."),
  longText(P8, "intended_not_employed_support", "If Not Employed, Explain How You Are Going to Support Yourself", false, { description: "Complete only if you will not be employed." }),
  text(P8, "intended_job_title", "Intended U.S. Occupation Title", false, { description: "Complete if you will be employed." }),
  text(P8, "intended_employer_name", "Employer or School Name", false),
  text(P8, "intended_employer_street", "Employer or School Street Address", false),
  text(P8, "intended_employer_city", "City", false),
  text(P8, "intended_employer_state", "State/Province", false),
  text(P8, "intended_employer_zip", "Postal Zone/ZIP Code", false),
  country(P8, "intended_employer_country", "Country/Region", false),
  phone(P8, "intended_employer_phone", "Telephone Number", false),
  yesNo(P8, "requires_two_years_training", "Does this job require at least 2 years of training?"),
  text(P8, "training_job_title", "Job Title", true, { cond: yes("requires_two_years_training") }),
  longText(P8, "training_work_description", "Describe the Type of Work", true, { cond: yes("requires_two_years_training") }),
  date(P8, "training_date_from", "Employment Date From", true, { cond: yes("requires_two_years_training") }),
  date(P8, "training_date_to", "Employment Date To", true, { cond: yes("requires_two_years_training") }),
  yesNo(P8, "previously_employed", "Were you previously employed?"),
  group(P8, "employment_history", "Employment History for Last 10 Years", true, {
    itemLabel: "Employer", addLabel: "+ Add Employer", summaryFields: ["employer_name", "occupation"],
    columns: [col("employer_name", "Full Name of Employer"), col("employer_address", "Full Address of Employer"), col("occupation", "Occupation"), col("supervisor_name", "Supervisor Full Name"),
      col("telephone", "Telephone Number", "phone"), col("from_date", "From Date", "date"), col("to_date", "To Date", "date")],
  }, { cond: yes("previously_employed") }),

  // Part 9
  yesNo(P9, "attended_school", "Have you attended any educational institutions at a secondary level or above?"),
  FIELD(P9, "institution_count", "Number of Educational Institutions Attended", "number", true, { cond: yes("attended_school"), rules: [{ type: "min", value: 1, message: "Enter at least 1." }] }),
  group(P9, "education_history", "Educational Institution History", true, {
    itemLabel: "Institution", addLabel: "+ Add Institution", summaryFields: ["institution_name", "degree"],
    columns: [col("institution_name", "Full Name of Institution"), col("institution_address", "Full Address of Institution"), col("course_of_study", "Course of Study"), col("degree", "Degree/Diploma"),
      col("attended_from", "Attendance From (MM/YYYY)", "text", { placeholder: "MM/YYYY", pattern: "^(0[1-9]|1[0-2])\\/(19|20)\\d{2}$" }), col("attended_to", "Attendance To (MM/YYYY)", "text", { placeholder: "MM/YYYY", pattern: "^(0[1-9]|1[0-2])\\/(19|20)\\d{2}$" })],
  }, { cond: yes("attended_school") }),

  // Part 10
  yesNo(P10, "traveled_last_5_years", "Have you traveled to any countries/regions within the last 5 years?"),
  group(P10, "countries_traveled", "Countries Traveled to During Last 5 Years", true, {
    itemLabel: "Country", addLabel: "+ Add Country", summaryFields: ["country"], columns: [countryCol("country", "Country/Region")],
  }, { cond: yes("traveled_last_5_years") }),
  yesNo(P10, "served_in_military", "Have you ever served in the military?"),
  country(P10, "military_country", "Name of Country/Region", true, { cond: yes("served_in_military") }),
  text(P10, "military_branch", "Branch of Service", true, { cond: yes("served_in_military") }),
  text(P10, "military_rank", "Rank/Position", true, { cond: yes("served_in_military") }),
  text(P10, "military_specialty", "Military Specialty", true, { cond: yes("served_in_military") }),
  date(P10, "military_date_from", "Date of Service From", true, { cond: yes("served_in_military") }),
  date(P10, "military_date_to", "Date of Service To", true, { cond: yes("served_in_military") }),
  yesNo(P10, "belonged_to_organization", "Have you belonged to, contributed to, or worked for any professional, social, or charitable organization?"),

  // Part 12
  yesNo(P12, "applied_for_ssn", "Have you ever applied for a Social Security number?"),
  yesNo(P12, "wants_ssn_issued", "Do you want the Social Security Administration to issue a Social Security number and a card?"),
  yesNo(P12, "authorizes_ssn_disclosure", "Do you authorize disclosure of information from this form to the Department of Homeland Security, the Social Security Administration, and such other U.S. Government agencies as may be required for the purposes of assigning you a Social Security number and issuing you a Social Security card, and do you authorize the Social Security Administration to share your SSN with the Department of Homeland Security?"),

  // Part 13
  text(P13, "petitioner_relation", "Petitioner is my (Mention Relation)"),
  text(P13, "petitioner_first_name", "Petitioner's First Name"),
  text(P13, "petitioner_last_name", "Petitioner's Last/Surname"),
  address(P13, "petitioner_address", "Petitioner's Address"),
  text(P13, "petitioner_city", "City"),
  text(P13, "petitioner_state", "State/Province"),
  text(P13, "petitioner_zip", "Postal Zone/ZIP Code"),
  country(P13, "petitioner_country", "Country/Region"),
  phone(P13, "petitioner_telephone", "Telephone"),
  phone(P13, "petitioner_mobile", "Mobile/Cell Telephone", false),
  email(P13, "petitioner_email", "Email Address"),
];

// ── builders ─────────────────────────────────────────────────────────────
function buildField(spec, order) {
  const questionKey = key(spec.name);
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
    ...(spec.cond ? { conditionalLogic: spec.cond } : {}),
    ...(spec.rules ? { validationRules: spec.rules } : {}),
    ...(spec.map ? { mapping: { canonicalPath: spec.map } } : {}),
  };
  if (spec.type !== "repeating_group") {
    return buildQuestion(questionKey, spec.label, spec.type, spec.section, order, { ...common, metadata: { sourcePath: `gcNvc.${spec.name}` } });
  }
  const config = spec.group;
  const metadata = {
    sourcePath: `gcNvc.${spec.name}`,
    ...(config.instructions ? { instructions: config.instructions } : {}),
    itemLabel: config.itemLabel,
    addLabel: config.addLabel,
    confirmRemove: `Remove this ${config.itemLabel.toLowerCase()}? This cannot be undone.`,
    summaryFields: config.summaryFields,
    fields: config.columns,
    repeatableFields: config.columns, // the admin answers panel reads this key
  };
  return buildQuestion(questionKey, spec.label, "repeating_group", spec.section, order, {
    ...common,
    metadata,
    repeatable: true,
    // no fixed record count: one row to start (when the group applies), the client adds as many more as needed
    repeatableConfig: { min: spec.required ? 1 : 0, ...(config.max ? { max: config.max } : {}), labelTemplate: `${config.itemLabel} {n}`, allowClientAdd: true },
  });
}

const SECURITY_QUESTION_KEYS = GC_NVC_SECURITY_QUESTIONS.map((_, index) => key(`security_q${index + 1}`));

// Part 11: each of the supplied questions stays its own Yes/No question (original number and order kept in metadata), and each
// "Yes" opens ITS OWN explanation. The closing general explanation shows when ANY answer above is Yes.
function buildSecurityQuestions(startOrder) {
  const questions = [];
  let order = startOrder;
  GC_NVC_SECURITY_QUESTIONS.forEach((label, index) => {
    const number = index + 1;
    questions.push(buildQuestion(SECURITY_QUESTION_KEYS[index], label, "radio", P11, ++order, {
      required: true,
      options: YES_NO,
      visibility: VISIBILITY,
      metadata: { sourcePath: `gcNvc.securityQ${number}`, questionNumber: number },
    }));
    questions.push(buildQuestion(key(`security_q${number}_explanation`), "Please explain", "textarea", P11, ++order, {
      required: true,
      visibility: VISIBILITY,
      conditionalLogic: when({ questionKey: SECURITY_QUESTION_KEYS[index], operator: "equals", value: "Yes" }),
      metadata: { sourcePath: `gcNvc.securityQ${number}Explanation`, questionNumber: number, explanationFor: SECURITY_QUESTION_KEYS[index] },
    }));
  });
  questions.push(buildQuestion(key("security_general_explanation"), "If you answer yes to any of the above questions, please explain below:", "textarea", P11, ++order, {
    required: true,
    visibility: VISIBILITY,
    conditionalLogic: whenAny(...SECURITY_QUESTION_KEYS.map((questionKey) => ({ questionKey, operator: "equals", value: "Yes" }))),
    metadata: { sourcePath: "gcNvc.securityGeneralExplanation" },
  }));
  return questions;
}

function buildDocuments() {
  return gcNvcDocuments.map((doc, index) => buildQuestion(doc.documentType, doc.name, "file", DOCS, index + 1, {
    required: doc.required,
    evidenceCategory: doc.category,
    metadata: { documentType: doc.documentType, category: doc.category },
    visibility: VISIBILITY,
  }));
}

function buildGcNvcChecklist() {
  const questions = [];
  let order = 0;
  for (const section of SECTIONS) {
    if (section === DOCS) continue;
    if (section === P11) { questions.push(...buildSecurityQuestions(order)); order += GC_NVC_SECURITY_QUESTIONS.length * 2 + 1; continue; }
    for (const spec of SPECS.filter((item) => item.section === section)) questions.push(buildField(spec, ++order));
  }
  questions.push(...buildDocuments());
  return {
    key: CHECKLIST_KEY,
    title: "GC-NVC - Information Checklist (DS-260)",
    visaType: "GCNVC",
    visaTypes: GC_NVC_VISA_TYPES,
    checklistRole: "client",
    isDefault: true,
    // brings an existing record's identity fields up to date in place (see the reconciler's reconcileMetadata option)
    reconcileMetadata: true,
    description: "Information needed for your Green Card application through the National Visa Center (DS-260).",
    sections: SECTIONS,
    questions,
  };
}

const GC_NVC_DEFINITIONS = [buildGcNvcChecklist()];

module.exports = { CHECKLIST_KEY, GC_NVC_VISA_TYPES, GC_NVC_DEFINITIONS, buildGcNvcChecklist, SECURITY_QUESTION_KEYS };
