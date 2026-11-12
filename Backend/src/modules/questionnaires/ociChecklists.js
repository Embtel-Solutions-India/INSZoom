// OCI (Overseas Citizen of India) - the "Indian Timeline Cases" section. One checklist per OCI SUBTYPE; this file holds the first:
//   Adult Foreign citizen and held Indian passport   (key "oci_adult_former_indian_passport_checklist")
//
// A single-person case type (like GC-NVC / the single-party filings): ONE client questionnaire answered by the applicant, NO USCIS forms, NO canonical mappings (nothing here
// carries a canonicalPath). The case manager creates the case in Admin (OCI + the subtype), the checklist is assigned to the client by the single-party filing mechanism
// (single-party-filings/single-party-filing.controller.js, registry config/filingTypes.js), the client answers / uploads / saves and submits, and Admin reads the same Answer rows.
//
// The checklist is NOT a default template of the OCI visa type (isDefault false): a later OCI subtype must never be handed the wrong subtype's checklist; the subtype's
// own filing-type entry names exactly which checklist a case gets.
//
// Requiredness: a question that is shown is required unless marked optional; every conditional question carries conditionalLogic, so it is never required while hidden. "N/A" is
// an ordinary text answer wherever a question is free text (the opening instruction); a document category that does not apply is simply not shown for that applicant.
const { buildQuestion } = require("./definitionHelpers");
const { COUNTRIES } = require("../../config/geoOptions");

const CHECKLIST_KEY = "oci_adult_former_indian_passport_checklist";
const OCI_VISA_TYPE = "OCI";
const SUBTYPE_LABEL = "Adult Foreign citizen and held Indian passport";
const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };
const YES_NO = [{ label: "Yes", value: "Yes" }, { label: "No", value: "No" }];
const COUNTRY_OPTIONS = COUNTRIES.map((value) => (typeof value === "object" ? value : { label: value, value }));

const S_INSTRUCTIONS = "Instructions";
const S_CONTACT = "Applicant Contact Information";
const S_A = "A. Personal and Background Details";
const S_B = "B. Family Information";
const S_C = "C. Employment and Occupation Details";
const S_D = "D. Prior OCI History and Relatives in India";
const S_DOCS = "Required Documents";
const SECTIONS = [S_INSTRUCTIONS, S_CONTACT, S_A, S_B, S_C, S_D, S_DOCS];

const INSTRUCTIONS = [
  "Complete the questionnaire thoroughly to enable accurate petition preparation.",
  "Enter N/A for questions or document categories that do not apply.",
  "All supporting document copies must be provided in color.",
  "Submit valid documents only. Expired documents or inaccurate information may cause application delays.",
];

const key = (name) => `oci_adult_${name}`;
const rule = (name, operator, value) => ({ questionKey: key(name), operator, ...(value === undefined ? {} : { value }) });
const all = (...rules) => ({ mode: "all", rules, groups: [] });
const any = (...rules) => ({ mode: "any", rules, groups: [] });
const eq = (name, value) => all(rule(name, "equals", value));

const SPECS = [];
const add = (section, name, label, type, extras = {}) => SPECS.push({ section, name, label, type, required: extras.required !== false, ...extras });
const text = (section, name, label, extras) => add(section, name, label, "text", extras);
const longText = (section, name, label, extras) => add(section, name, label, "textarea", extras);
const phone = (section, name, label, extras) => add(section, name, label, "phone", extras);
const date = (section, name, label, extras) => add(section, name, label, "date", extras);
const country = (section, name, label, extras) => add(section, name, label, "select", { options: COUNTRY_OPTIONS, ...extras });
const select = (section, name, label, options, extras) => add(section, name, label, "select", { options, ...extras });
const yesNo = (section, name, label, extras) => add(section, name, label, "radio", { options: YES_NO, ...extras });
const file = (section, name, label, extras) => add(section, name, label, "file", extras);
const group = (section, name, label, config, extras) => add(section, name, label, "repeating_group", { group: config, ...extras });
const col = (columnKey, label, type = "text", extras = {}) => ({ key: columnKey, label, type, required: true, ...extras });

// ---- Instructions (informational; shown at the top of the checklist - not answer fields) ----
// (carried by the checklist description below)

// ---- Applicant contact ----
text(S_CONTACT, "full_name", "Applicant Full Name");
phone(S_CONTACT, "phone", "Phone Number");

// ---- A. Personal and background ----
select(S_A, "marital_status", "Marital Status", ["Single / Never Married", "Married", "Divorced", "Widowed", "Separated"]);
text(S_A, "distinguishing_mark", "Visible Distinguishing Mark", { required: false, description: "Enter N/A if none." });
select(S_A, "root_ancestor_relationship", "Relationship with Root Indian Ancestor", ["Self", "Father", "Mother", "Grandparent"]);
country(S_A, "country_of_birth", "Country of Birth");
text(S_A, "place_of_birth", "Place of Birth (Province/Town/City)");
country(S_A, "current_nationality", "Current Nationality");

// ---- B. Family ----
text(S_B, "father_name", "Father's Full Name");
country(S_B, "father_nationality", "Father's Nationality");
text(S_B, "father_occupation", "Father's Occupation");
text(S_B, "mother_name", "Mother's Full Name");
country(S_B, "mother_nationality", "Mother's Nationality");
text(S_B, "mother_occupation", "Mother's Occupation");
yesNo(S_B, "spouse_based_oci", "Are you applying for OCI on the basis of an Indian spouse / spouse's OCI card?");
const SPOUSE_APPLIES = any(rule("marital_status", "equals", "Married"), rule("spouse_based_oci", "equals", "Yes"));
text(S_B, "spouse_name", "Spouse's Full Name", { cond: SPOUSE_APPLIES });
date(S_B, "spouse_dob", "Spouse's Date of Birth", { cond: SPOUSE_APPLIES });
country(S_B, "spouse_nationality", "Spouse's Nationality", { cond: SPOUSE_APPLIES });
text(S_B, "spouse_occupation", "Spouse's Occupation", { cond: SPOUSE_APPLIES });
date(S_B, "marriage_date", "Marriage Date", { cond: SPOUSE_APPLIES });

// ---- C. Employment ----
text(S_C, "current_occupation", "Current Occupation / Designation", { description: "Enter N/A if not applicable." });
select(S_C, "employment_situation", "Current employment situation", ["Employed", "Self-employed / Business owner", "Retired", "Student", "Never employed or self-employed"]);
longText(S_C, "employer_name_address", "Employer Name and Office Address", { cond: eq("employment_situation", "Employed") });
phone(S_C, "employer_phone", "Employer Contact Number", { cond: eq("employment_situation", "Employed") });
text(S_C, "retired_organization", "If Retired, Department / Office / Organization", { cond: eq("employment_situation", "Retired") });

// ---- D. Prior OCI history and relatives ----
yesNo(S_D, "prior_oci_applied", "Have you or any member of your family applied for OCI registration earlier?");
group(S_D, "prior_oci_applications", "Previous OCI applications", {
  itemLabel: "Application", addLabel: "+ Add Application", summaryFields: ["name", "reference_number"],
  columns: [col("name", "Name"), col("relationship", "Relationship"), col("reference_number", "Reference Number"), col("date_applied", "Date When Applied", "date"), col("place_applied", "Place Where Applied"), col("status", "Application Status")],
}, { cond: eq("prior_oci_applied", "Yes") });
yesNo(S_D, "oci_surrendered_or_cancelled", "Have you ever surrendered an OCI card or had a previous OCI card cancelled?");
longText(S_D, "oci_surrender_details", "Please give details", { cond: eq("oci_surrendered_or_cancelled", "Yes") });
group(S_D, "relatives_in_india", "Family members / relatives currently residing in India", {
  itemLabel: "Relative", addLabel: "+ Add Relative", summaryFields: ["name", "relationship"],
  columns: [col("name", "Relative Name"), col("relationship", "Relationship"), col("age", "Age", "number", { min: 0, max: 130, step: "1" }), col("address", "Present Address in India", "textarea")],
}, { required: false, description: "Optional. Leave empty (or enter N/A below in your notes) if you have no relatives residing in India." });

// ---- Documents ----
file(S_DOCS, "doc_digital_photo", "Digital Photograph", {
  description: "Digital photograph - white background; dark-colored attire; taken no more than two months ago; shoulders clearly visible; no glare or shadows on the face or anywhere in the photograph; high-quality HD photograph. (If you cannot upload it here, send it by email as instructed by your case manager.)",
});
file(S_DOCS, "doc_signature", "Signature", {
  description: "Sign on a plain white sheet of paper with a dark-colored pen; make sure the signature is clear and properly visible; scan the signed page in high quality. (If you cannot upload it here, send it by email as instructed by your case manager.)",
});
add(S_DOCS, "physical_photos_ack", "Physical Photographs", "radio", {
  options: [{ label: "I will provide three identical physical passport-sized photographs when the application is lodged", value: "confirmed" }],
  description: "Three identical physical passport-sized photographs, 2 inches × 2 inches, white background. They are submitted physically at the time of application lodging - do not upload them here.",
});
file(S_DOCS, "doc_current_passport", "Current Valid Passport", { description: "Color copies of the first two and last two pages of your current valid passport. The passport must have at least nine months of validity remaining." });
file(S_DOCS, "doc_last_indian_passport", "Last Held Indian Passport", { description: "A copy of the last Indian passport you held." });

select(S_DOCS, "naturalization_basis", "How was naturalization acquired?", ["In my own right (I hold a naturalization certificate)", "Through my parents (no separate certificate)"]);
const OWN_CERT = eq("naturalization_basis", "In my own right (I hold a naturalization certificate)");
const PARENTS = eq("naturalization_basis", "Through my parents (no separate certificate)");
add(S_DOCS, "naturalization_year", "Year of naturalization", "number", { min: 1900, max: 2100, step: "1", description: "Used to decide whether a surrender certificate applies (naturalized from 2010 onwards)." });
file(S_DOCS, "doc_naturalization_certificate", "Naturalization Certificate", { cond: OWN_CERT, description: "A copy of the naturalization certificate. It must be signed in the designated space." });
file(S_DOCS, "doc_parents_affidavit", "Notarized affidavit signed by both parents", { cond: PARENTS, description: "Instead of a separate certificate: a notarized affidavit signed by both parents." });
file(S_DOCS, "doc_parents_naturalization_certificates", "Copies of both parents' naturalization certificates", { cond: PARENTS });
file(S_DOCS, "doc_surrender_certificate", "Surrender Certificate", { cond: all(rule("naturalization_year", "gte", 2010)), description: "Applicable only to applicants who were naturalized from 2010 onwards." });

yesNo(S_DOCS, "holds_us_passport", "Do you hold a U.S. passport?");
const NO_US_PASSPORT = eq("holds_us_passport", "No");
select(S_DOCS, "legal_status_document", "Legal status document you will provide", ["Green Card", "Employment Authorization Document (EAD)", "Long-term U.S. visa"], { cond: NO_US_PASSPORT });
file(S_DOCS, "doc_green_card", "Green Card (front and back)", { cond: all(rule("holds_us_passport", "equals", "No"), rule("legal_status_document", "equals", "Green Card")) });
file(S_DOCS, "doc_ead", "Valid Employment Authorization Document (EAD)", { cond: all(rule("holds_us_passport", "equals", "No"), rule("legal_status_document", "equals", "Employment Authorization Document (EAD)")) });
file(S_DOCS, "doc_long_term_visa", "Long-term U.S. visa", { cond: all(rule("holds_us_passport", "equals", "No"), rule("legal_status_document", "equals", "Long-term U.S. visa")) });
yesNo(S_DOCS, "visa_extension_pending", "Is a visa extension pending?", { cond: NO_US_PASSPORT });
const EXTENSION_PENDING = all(rule("holds_us_passport", "equals", "No"), rule("visa_extension_pending", "equals", "Yes"));
file(S_DOCS, "doc_extension_receipt", "I-797A or I-797C notice for the pending extension", { cond: EXTENSION_PENDING });
file(S_DOCS, "doc_expired_visa", "Expired visa", { cond: EXTENSION_PENDING });

// marital status evidence
yesNo(S_DOCS, "remarried_after_divorce", "Did you remarry after a divorce?", { cond: eq("marital_status", "Married") });
yesNo(S_DOCS, "marital_certificate_unavailable", "Is a required marital-status certificate unavailable?", { cond: any(rule("marital_status", "equals", "Married"), rule("marital_status", "equals", "Divorced"), rule("marital_status", "equals", "Widowed")) });
// the "unavailable" question is optional to answer, so the evidence rules test for "not Yes"
const certificateAvailable = (...statusRules) => all(rule("marital_certificate_unavailable", "not_equals", "Yes"), ...statusRules);
file(S_DOCS, "doc_marriage_certificate", "Marriage certificate", { cond: certificateAvailable(rule("marital_status", "equals", "Married")) });
file(S_DOCS, "doc_divorce_decree", "Divorce decree", { cond: { mode: "all", rules: [rule("marital_certificate_unavailable", "not_equals", "Yes")], groups: [any(rule("marital_status", "equals", "Divorced"), rule("remarried_after_divorce", "equals", "Yes"))] } });
file(S_DOCS, "doc_death_certificate", "Death certificate of the spouse", { cond: certificateAvailable(rule("marital_status", "equals", "Widowed")) });
file(S_DOCS, "doc_marital_affidavit", "Notarized affidavit confirming marital status", { cond: eq("marital_certificate_unavailable", "Yes"), description: "Explain why the required certificate is unavailable." });

// name change
yesNo(S_DOCS, "used_previous_name", "Have you ever used a previous name or legally changed your name?");
group(S_DOCS, "previous_names", "Previous name(s)", {
  itemLabel: "Previous name", addLabel: "+ Add Name", summaryFields: ["name"], columns: [col("name", "Previous name")],
}, { cond: eq("used_previous_name", "Yes") });
file(S_DOCS, "doc_name_change", "Proof of name change", { cond: eq("used_previous_name", "Yes"), description: "A legal name-change document from a local court, or a duly notarized affidavit." });

// employment / work verification
file(S_DOCS, "doc_employer_letter", "Employer letter describing your job profile", { cond: eq("employment_situation", "Employed") });
file(S_DOCS, "doc_self_employment", "Documentary evidence of self-employment or business", { cond: eq("employment_situation", "Self-employed / Business owner") });
file(S_DOCS, "doc_retirement_proof", "Documentary proof of retirement", { cond: eq("employment_situation", "Retired"), description: "Also give the details of your last employer in section C." });
file(S_DOCS, "doc_student_proof", "Documentary proof of studies (for example an admission letter)", { cond: eq("employment_situation", "Student") });
file(S_DOCS, "doc_never_employed_statement", "Written statement confirming you have never been employed or self-employed", { cond: eq("employment_situation", "Never employed or self-employed") });

// OCI cards of family
yesNo(S_DOCS, "family_holds_oci", "Do your parents and/or spouse hold OCI cards?", { required: false });
file(S_DOCS, "doc_family_oci_cards", "Copies of the OCI cards of your parents and/or spouse", { cond: eq("family_holds_oci", "Yes"), required: false });

// previous Indian visa
yesNo(S_DOCS, "previous_indian_visa", "Have you ever been issued an Indian visa?");
file(S_DOCS, "doc_previous_indian_visa", "Copy of the previously issued Indian visa", { cond: eq("previous_indian_visa", "Yes") });

// US address proof
select(S_DOCS, "us_address_proof_type", "U.S. address proof you will provide", ["State-issued ID", "Driver's license", "Utility bill (water, gas, electricity or telephone) dated within the last three months", "Valid lease agreement", "Mortgage statement", "Recent tax return"]);
file(S_DOCS, "doc_us_address_proof", "Proof of U.S. address", { description: "Upload the document of the type selected above (only one is needed)." });

// native address proof (non-US nationals)
const NON_US = all(rule("current_nationality", "not_equals", "United States"), rule("current_nationality", "not_empty"));
yesNo(S_DOCS, "dual_citizen", "Are you a dual citizen?", { cond: NON_US });
file(S_DOCS, "doc_native_address_proof", "Proof of your address in your native / home country", { cond: NON_US, description: "If proof is unavailable, upload a notarized statement explaining your native address instead." });
group(S_DOCS, "dual_citizen_countries", "Countries of citizenship and native address", {
  itemLabel: "Country", addLabel: "+ Add Country", summaryFields: ["country"], columns: [col("country", "Country", "select", { options: COUNTRY_OPTIONS }), col("address", "Native address in that country", "textarea")],
}, { cond: all(rule("current_nationality", "not_equals", "United States"), rule("dual_citizen", "equals", "Yes")), description: "Dual citizens give native-address proof for both countries." });
file(S_DOCS, "doc_native_address_proof_second", "Proof of your address in your second country of citizenship", { cond: all(rule("current_nationality", "not_equals", "United States"), rule("dual_citizen", "equals", "Yes")) });

function buildField(spec, order) {
  const common = {
    required: spec.required,
    description: spec.description,
    options: spec.options,
    visibility: VISIBILITY,
    ...(spec.cond ? { conditionalLogic: spec.cond } : {}),
  };
  const questionKey = key(spec.name);
  if (spec.type === "file") {
    return buildQuestion(questionKey, spec.label, "file", spec.section, order, { ...common, evidenceCategory: "supporting_document", metadata: { documentType: questionKey, category: "supporting_document" } });
  }
  if (spec.type === "number") {
    return buildQuestion(questionKey, spec.label, "number", spec.section, order, { ...common, metadata: { min: spec.min, max: spec.max, step: spec.step } });
  }
  if (spec.type !== "repeating_group") return buildQuestion(questionKey, spec.label, spec.type, spec.section, order, { ...common, metadata: {} });
  const config = spec.group;
  return buildQuestion(questionKey, spec.label, "repeating_group", spec.section, order, {
    ...common,
    metadata: {
      itemLabel: config.itemLabel, addLabel: config.addLabel, confirmRemove: `Remove this ${config.itemLabel.toLowerCase()}? This cannot be undone.`,
      summaryFields: config.summaryFields, fields: config.columns, repeatableFields: config.columns,
    },
    repeatable: true,
    repeatableConfig: { min: spec.required ? 1 : 0, labelTemplate: `${config.itemLabel} {n}`, allowClientAdd: true },
  });
}

function buildOciAdultChecklist() {
  const counters = new Map();
  const questions = SPECS.map((spec) => {
    const order = (counters.get(spec.section) || 0) + 1;
    counters.set(spec.section, order);
    return buildField(spec, order);
  });
  return {
    key: CHECKLIST_KEY,
    title: SUBTYPE_LABEL,
    visaType: OCI_VISA_TYPE,
    visaTypes: [OCI_VISA_TYPE],
    checklistRole: "client",
    isDefault: false, // assigned only by the OCI subtype's own filing type (never to another OCI subtype)
    reconcileMetadata: true,
    description: `For adult foreign citizens who previously held an Indian passport and are applying for Overseas Citizen of India (OCI) registration.\n\n${INSTRUCTIONS.map((line) => `• ${line}`).join("\n")}`,
    sections: SECTIONS.filter((section) => section !== S_INSTRUCTIONS),
    questions,
  };
}

const OCI_CHECKLIST_DEFINITIONS = [buildOciAdultChecklist()];

module.exports = { CHECKLIST_KEY, OCI_VISA_TYPE, SUBTYPE_LABEL, INSTRUCTIONS, OCI_CHECKLIST_DEFINITIONS, buildOciAdultChecklist };
