// Converts the supplied "Change of Address" (internal reference: AR-11)
// questionnaire into real Questionnaire/Question template definitions, in
// the same shape as questionnaire.service.js's VISA_TEMPLATE_DEFINITIONS —
// mirrors n565Checklist.js's single-record content-module pattern.
//
// CRITICAL — an optional, visa-agnostic, CASE-STRUCTURE-agnostic add-on
// component, exactly like n400Checklist.js/n600Checklist.js: deliberately
// NOT isDefault, and NOT scoped to any real visa type. Reachable ONLY
// through an explicit questionnaireReferences entry created by a Case
// Manager via case.controller.js's addChangeOfAddress. pseudo
// visaType:"COA" below never matches a real Case.visaType — same double
// guarantee every other optional component this session uses.
//
// UNLIKE every other optional component so far, this one must be
// attachable to ANY of the six existing participant roles (employer/
// employee/petitioner/beneficiary/joint_sponsor/client), and each role's
// address lives in a DIFFERENT canonical namespace:
//   - employee/beneficiary/client -> "contact.address.*" (the existing
//     shared personal-address namespace - see CanonicalBuilderService.js's
//     own "beneficiary.address" -> "contact.address.line1" mapping and
//     profileCanonicalMap.js's "currentAddress.street" -> same path)
//   - employer -> "company.address.*" (profileCanonicalMap.js)
//   - petitioner / joint_sponsor -> "petitioner.address.*" /
//     "jointSponsor.address.*" - NOT an existing dedicated field-map
//     entry, but CanonicalBuilderService.js's addQuestionnaireCandidates
//     (line ~253) already generically promotes ANY question's
//     mapping.canonicalPath into the merged profile at that exact path -
//     confirmed by reading the file: merged.profile.petitioner is built as
//     `{...(merged.profile.petitioner||{}), ...rawCollections.petitioner}`
//     (line ~442), which only ever touches `.name` for an employer_employee
//     case (line 443) and never touches `.address` - so a petitioner.address.*
//     candidate survives untouched. jointSponsor is never referenced
//     anywhere else in that file, so nothing can overwrite it either. This
//     means petitioner/joint_sponsor propagation needs ZERO changes to
//     CanonicalBuilderService.js/profileCanonicalMap.js - just the correct
//     canonicalPath on these questions, exactly the same generic mechanism
//     every other checklist's canonicalPath/mapping already relies on.
//
// One shared field-shape function (fieldCatalog(canonicalPrefix)),
// generating 4 Questionnaire variants below - the same "one content
// module, multiple generated role-specific templates" pattern i140.js/
// tn.js already established this session (there, the variation was by
// visaType; here it's by canonical namespace).

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];

function slugSection(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
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
    ...(extras.canonicalPath ? { mapping: { canonicalPath: extras.canonicalPath } } : {}),
    visibility: extras.visibility,
    conditionalLogic: extras.conditionalLogic || { mode: "all", rules: [], groups: [] },
    repeatable: Boolean(extras.repeatable),
  };
}

const INFO_SECTION = "Information About You";
const PRESENT_SECTION = "Present Physical Address";
const PREVIOUS_SECTION = "Previous Physical Address";
const MAILING_SECTION = "Mailing Address";

// canonicalPrefix - the merged-profile top-level namespace this variant's
// Present Physical Address feeds ("contact" | "company" | "petitioner" |
// "jointSponsor"). Every other section is identical across variants and
// carries no canonicalPath (see file banner for why Previous/Mailing are
// deliberately not autofill sources in this first pass).
function fieldCatalog(canonicalPrefix, visibility) {
  const addr = (suffix) => `${canonicalPrefix}.address.${suffix}`;
  return [
    // Information About You - identity confirmation only, not autofill sources.
    buildQuestion("coa_lastName", "Last Name", "text", INFO_SECTION, 1, { required: true, visibility }),
    buildQuestion("coa_firstName", "First Name", "text", INFO_SECTION, 2, { required: true, visibility }),
    buildQuestion("coa_middleName", "Middle Name", "text", INFO_SECTION, 3, { visibility }),
    buildQuestion("coa_dateOfBirth", "Date of Birth", "date", INFO_SECTION, 4, { required: true, visibility }),
    buildQuestion("coa_aNumber", "A-Number", "text", INFO_SECTION, 5, { visibility }),

    // Present Physical Address - the only section that drives autofill.
    buildQuestion("coa_present_street", "Street Number and Name", "text", PRESENT_SECTION, 1, { required: true, canonicalPath: addr("line1"), visibility }),
    buildQuestion("coa_present_apt", "Apartment/Suite/Floor", "text", PRESENT_SECTION, 2, { canonicalPath: addr("line2"), visibility }),
    buildQuestion("coa_present_city", "City/Town", "text", PRESENT_SECTION, 3, { required: true, canonicalPath: addr("city"), visibility }),
    buildQuestion("coa_present_state", "State", "text", PRESENT_SECTION, 4, { required: true, canonicalPath: addr("state"), visibility }),
    buildQuestion("coa_present_zip", "ZIP Code", "text", PRESENT_SECTION, 5, { required: true, canonicalPath: addr("zip"), visibility }),

    // Previous Physical Address - self-reported/informational. The
    // system's own authoritative record of the prior address is captured
    // by AddressChangeService at Case-Manager-approval time (from whatever
    // the canonical value already was), not from this recollection field -
    // deliberately no canonicalPath here (see file banner).
    buildQuestion("coa_previous_street", "Street Number and Name", "text", PREVIOUS_SECTION, 1, { required: true, visibility }),
    buildQuestion("coa_previous_apt", "Apartment/Suite/Floor", "text", PREVIOUS_SECTION, 2, { visibility }),
    buildQuestion("coa_previous_city", "City/Town", "text", PREVIOUS_SECTION, 3, { required: true, visibility }),
    buildQuestion("coa_previous_state", "State", "text", PREVIOUS_SECTION, 4, { required: true, visibility }),
    buildQuestion("coa_previous_zip", "ZIP Code", "text", PREVIOUS_SECTION, 5, { required: true, visibility }),

    // Mailing Address - "same as present?" gate; no canonicalPath in this
    // first pass (no existing form crosswalk maps a distinct mailing-
    // address concept yet - can be wired later via the same mechanism).
    buildQuestion("coa_mailing_sameAsPresent", "Same as Present Physical Address", "radio", MAILING_SECTION, 1, { required: true, options: ["Yes", "No"], visibility }),
    buildQuestion("coa_mailing_street", "Street Number and Name", "text", MAILING_SECTION, 2, { conditionalLogic: { mode: "all", rules: [{ questionKey: "coa_mailing_sameAsPresent", operator: "equals", value: "No" }], groups: [] }, visibility }),
    buildQuestion("coa_mailing_apt", "Apartment/Suite/Floor", "text", MAILING_SECTION, 3, { conditionalLogic: { mode: "all", rules: [{ questionKey: "coa_mailing_sameAsPresent", operator: "equals", value: "No" }], groups: [] }, visibility }),
    buildQuestion("coa_mailing_city", "City/Town", "text", MAILING_SECTION, 4, { conditionalLogic: { mode: "all", rules: [{ questionKey: "coa_mailing_sameAsPresent", operator: "equals", value: "No" }], groups: [] }, visibility }),
    buildQuestion("coa_mailing_state", "State", "text", MAILING_SECTION, 5, { conditionalLogic: { mode: "all", rules: [{ questionKey: "coa_mailing_sameAsPresent", operator: "equals", value: "No" }], groups: [] }, visibility }),
    buildQuestion("coa_mailing_zip", "ZIP Code", "text", MAILING_SECTION, 6, { conditionalLogic: { mode: "all", rules: [{ questionKey: "coa_mailing_sameAsPresent", operator: "equals", value: "No" }], groups: [] }, visibility }),
  ];
}

const SECTIONS = [INFO_SECTION, PRESENT_SECTION, PREVIOUS_SECTION, MAILING_SECTION];
// Client-facing title/description throughout - plain language, never
// "AR-11" or "dependency mapping" (integration prompt §4).
const TITLE = "Change of Address";
const DESCRIPTION = "Tell us your previous and new physical address so we can update your immigration records.";

function buildVariant({ key, checklistRole, actualRoles, portals, canonicalPrefix }) {
  // visibility.roles must list every ACTUAL portal role this template can
  // be assigned under (the questionnaireReference's own targetRole, set at
  // attach time by case.controller.js's addChangeOfAddress) - not just the
  // template's own nominal checklistRole. The "person" variant below is
  // shared across employee/beneficiary/client (all resolve through the
  // same "contact.*" canonical namespace - see file banner), so a single
  // fixed checklistRole here would otherwise wrongly block two of those
  // three actual users from seeing their own checklist.
  // visibility.portals is a DIFFERENT, coarser concept than roles - it's
  // which frontend APP surfaces this question (Question.js's own strict
  // enum: only "client"/"admin"/"employer"/"employee" are valid values -
  // "beneficiary"/"petitioner"/"joint_sponsor" are NOT, since those roles
  // all use the client-portal app, exactly like familyChecklists.js's own
  // petitioner/beneficiary/joint_sponsor checklists already set
  // portals:["client","admin"], never portals:["petitioner","admin"] etc.
  const visibility = { roles: [...actualRoles, ...STAFF_ROLES], portals: [...portals, "admin"] };
  return {
    key,
    title: TITLE,
    description: DESCRIPTION,
    visaType: "COA",
    checklistRole,
    isDefault: false,
    sections: SECTIONS,
    questions: fieldCatalog(canonicalPrefix, visibility),
  };
}

const CHANGE_OF_ADDRESS_DEFINITIONS = [
  buildVariant({ key: "change_of_address_person_checklist", checklistRole: "client", actualRoles: ["client", "employee", "beneficiary"], portals: ["client", "employee"], canonicalPrefix: "contact" }),
  buildVariant({ key: "change_of_address_employer_checklist", checklistRole: "employer", actualRoles: ["employer"], portals: ["employer"], canonicalPrefix: "company" }),
  buildVariant({ key: "change_of_address_petitioner_checklist", checklistRole: "petitioner", actualRoles: ["petitioner"], portals: ["client"], canonicalPrefix: "petitioner" }),
  buildVariant({ key: "change_of_address_joint_sponsor_checklist", checklistRole: "joint_sponsor", actualRoles: ["joint_sponsor"], portals: ["client"], canonicalPrefix: "jointSponsor" }),
];

// Maps a Case.changeOfAddressComponents targetRole to the checklist key
// case.controller.js's addChangeOfAddress should assign. employee/
// beneficiary both use the shared "person" variant (contact.address.* is
// the same existing shared namespace both already resolve through - see
// file banner), matching how the rest of this codebase already treats
// employee/beneficiary as the same underlying canonical identity.
const CHECKLIST_KEY_BY_TARGET_ROLE = {
  employee: "change_of_address_person_checklist",
  beneficiary: "change_of_address_person_checklist",
  client: "change_of_address_person_checklist",
  employer: "change_of_address_employer_checklist",
  petitioner: "change_of_address_petitioner_checklist",
  joint_sponsor: "change_of_address_joint_sponsor_checklist",
};

// The canonical namespace prefix a given targetRole's Present Physical
// Address feeds - used by AddressChangeService to know which merged-profile
// path to snapshot before a Case Manager's approval lets the new address win.
const CANONICAL_PREFIX_BY_TARGET_ROLE = {
  employee: "contact",
  beneficiary: "contact",
  client: "contact",
  employer: "company",
  petitioner: "petitioner",
  joint_sponsor: "jointSponsor",
};

module.exports = {
  CHANGE_OF_ADDRESS_DEFINITIONS,
  CHECKLIST_KEY_BY_TARGET_ROLE,
  CANONICAL_PREFIX_BY_TARGET_ROLE,
};
