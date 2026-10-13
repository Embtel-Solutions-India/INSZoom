// "Questionnaire for Form I-90 - Application to Replace Permanent Resident Card": the ONE client checklist of the "Green Card Renewal"
// case type (Case.visaType "Green Card Renewal", registered in config/visaCategories.js as a single-party case that provisions Form I-90
// and ONLY Form I-90 - see visaFormMappings.seed.js). It serves an EXISTING permanent resident asking USCIS to renew, replace, correct or
// update the card; it is completely separate from the I-130 family petition, Green Card / adjustment of status and GC-NVC workflows, and
// the case never has a petitioner / beneficiary split. checklistRole is "client" (the same single-party mechanism singlePartyChecklists.js,
// f1ReinstatementChecklist.js and i907_premium_processing_profile use), isDefault:true, so it is provisioned with the case and - like every
// automatic checklist - stays a draft until a case manager approves it (see checklist-gate.js / case-checklist.service.js).
//
// SOURCE OF TRUTH FOR WHAT TO ASK: the official Form I-90, edition 01/20/25 (dev-assets/uscis/i-90_2025-20-01.pdf). Where the supplied draft
// questionnaire and the form differ, the FORM wins - for example the form asks for the parents' GIVEN names only (Items 12-13), has no
// separate port-of-entry / mailing-vs-physical "same as" box, and splits "Reason for Application" into ten Section A reasons and five
// Section B reasons. Items that exist only on the form (ethnicity, race, name on card, removal proceedings, I-407, accommodations) are asked
// here as well, because a client who does not answer them leaves those boxes blank.
//
// HOW QUESTIONS REACH THE FORM (nothing here is named after a PDF field):
//   answer -> question.mapping.canonicalPath (person.* / contact.* / immigration.*, registered in canonical/config/i90CanonicalPaths.js)
//          -> Case.canonicalProfile (with provenance, via CanonicalBuilderService) -> form-mapping/config/i90-crosswalk.js -> the PDF widget.
//   Every USCIS field identifier lives in that crosswalk; each question only carries metadata.formRef (a human label such as "Part 1, Item 3.b")
//   and metadata.pdfAutofill (true = the crosswalk fills a box from it). A unit test keeps both in sync with the crosswalk.
//
// REQUIRED / OPTIONAL: Question.required is always stored false in this system - a client can always save a partial draft - and SUBMIT needs
// every VISIBLE question answered (questionnaire.service.js calculateCompletion / assertSubmittable). So "optional" is expressed the way the
// rest of the platform does it: the question is simply not shown until a gate answer says it applies ("Do you have a middle name?",
// "Is your physical address different?", the reason-specific follow-ups, ...). metadata.requirement records the intent per question:
//   "required"    - always shown, always owed
//   "conditional" - shown only while its conditionalLogic holds, owed then
//   (a document question that is conditional is judged inside the questionnaire only - document-requirement.resolver.js does not copy it
//    onto the case as a standing required document.)
//
// Client-facing title: the checklist's own `title` (what the client portal renders as the checklist name).

const { buildQuestion, slugSection } = require("./definitionHelpers");
const { US_STATES, COUNTRIES } = require("../../config/geoOptions");

const STAFF_ROLES = ["case_manager", "team_lead", "admin", "super_admin"];
const VISIBILITY = { roles: ["client", ...STAFF_ROLES], portals: ["client", "admin"] };

const TITLE = "Questionnaire for Form I-90 — Application to Replace Permanent Resident Card";

const SECTIONS = {
  reason: "Application Reason",
  identity: "Applicant Identity",
  address: "Address and Contact Information",
  residence: "Permanent Residence and Admission Information",
  accommodations: "Accommodations",
  documents: "Supporting Documents",
};

// ── conditionalLogic builders (shape = Question.conditionalLogic: { mode, rules: [{ questionKey, operator, value }], groups }) ─────────
const rule = (questionKey, operator, value) => ({ questionKey, operator, value });
const all = (...rules) => ({ mode: "all", rules, groups: [] });
const any = (...rules) => ({ mode: "any", rules, groups: [] });
const eq = (questionKey, value) => rule(questionKey, "equals", value);
const oneOf = (questionKey, values) => rule(questionKey, "in", values);

// Internal question keys (one place, so a gate can never drift from the question it points at).
const K = {
  reason: "i90_applicationReason",
  statusType: "i90_residentStatusType",
  cardExpiration: "i90_cardExpirationDate",
  replacementCircumstance: "i90_replacementCircumstance",
  incidentDate: "i90_incidentDate",
  incidentDescription: "i90_incidentDescription",
  cardAvailable: "i90_damagedCardAvailable",
  correctionCause: "i90_correctionCause",
  correctionItems: "i90_correctionItems",
  bioChangeType: "i90_biographicChangeType",
  bioPrevious: "i90_biographicPreviousValue",
  bioNew: "i90_biographicNewValue",
  bioEffective: "i90_biographicEffectiveDate",
  bioLegalDocument: "i90_biographicLegalDocument",
  otherReason: "i90_otherReason",
  commuterPoeCity: "i90_commuterPortOfEntryCity",
  commuterPoeState: "i90_commuterPortOfEntryState",

  aNumber: "i90_aNumber",
  hasAccount: "i90_hasUscisOnlineAccount",
  account: "i90_uscisOnlineAccountNumber",
  hasSsn: "i90_hasSsn",
  ssn: "i90_ssn",
  lastName: "i90_lastName",
  firstName: "i90_firstName",
  hasMiddle: "i90_hasMiddleName",
  middleName: "i90_middleName",
  nameChanged: "i90_nameChangedSinceCardIssued",
  cardLast: "i90_cardLastName",
  cardFirst: "i90_cardFirstName",
  cardHasMiddle: "i90_cardHasMiddleName",
  cardMiddle: "i90_cardMiddleName",
  sex: "i90_sex",
  dob: "i90_dateOfBirth",
  cityOfBirth: "i90_cityOfBirth",
  countryOfBirth: "i90_countryOfBirth",
  mother: "i90_motherGivenName",
  father: "i90_fatherGivenName",
  ethnicity: "i90_ethnicity",
  race: "i90_race",
  heightFeet: "i90_heightFeet",
  heightInches: "i90_heightInches",
  weight: "i90_weightPounds",
  eye: "i90_eyeColor",
  hair: "i90_hairColor",

  mailStreet: "i90_mailingStreet",
  mailUnitType: "i90_mailingUnitType",
  mailUnitNumber: "i90_mailingUnitNumber",
  mailCity: "i90_mailingCity",
  mailCountry: "i90_mailingCountry",
  mailState: "i90_mailingState",
  mailZip: "i90_mailingZip",
  mailProvince: "i90_mailingProvince",
  mailPostal: "i90_mailingPostalCode",
  physDifferent: "i90_physicalAddressDifferent",
  physStreet: "i90_physicalStreet",
  physUnitType: "i90_physicalUnitType",
  physUnitNumber: "i90_physicalUnitNumber",
  physCity: "i90_physicalCity",
  physCountry: "i90_physicalCountry",
  physState: "i90_physicalState",
  physZip: "i90_physicalZip",
  physProvince: "i90_physicalProvince",
  physPostal: "i90_physicalPostalCode",
  phone: "i90_daytimePhone",
  email: "i90_emailAddress",

  classOfAdmission: "i90_classOfAdmission",
  dateOfAdmission: "i90_dateOfAdmission",
  greenCardPath: "i90_greenCardPath",
  appliedLocation: "i90_locationAppliedForVisa",
  issuedLocation: "i90_locationVisaIssued",
  destination: "i90_destinationAtAdmission",
  poeCity: "i90_portOfEntryCity",
  poeState: "i90_portOfEntryState",
  removal: "i90_removalProceedings",
  removalExplanation: "i90_removalProceedingsExplanation",
  abandonment: "i90_abandonmentDetermination",
  abandonmentExplanation: "i90_abandonmentExplanation",

  accommodation: "i90_accommodationRequested",
  accommodationTypes: "i90_accommodationTypes",
  deafDetails: "i90_accommodationDeafDetails",
  blindDetails: "i90_accommodationBlindDetails",
  otherDetails: "i90_accommodationOtherDetails",

  hasPreviousCard: "i90_hasPreviousCard",
  hasStateId: "i90_hasStateIdentification",
};

// ── gates reused by several questions / documents ──────────────────────────────────────────────────────────────────────────────────
const isRenewal = all(eq(K.reason, "renewal"));
const isReplacement = all(eq(K.reason, "replacement"));
const isCorrection = all(eq(K.reason, "correction"));
const isBiographic = all(eq(K.reason, "biographic_update"));
const isOther = all(eq(K.reason, "other"));
const LOSS_LIKE = ["lost", "stolen", "destroyed", "never_received"];
const isLossLike = all(eq(K.reason, "replacement"), oneOf(K.replacementCircumstance, LOSS_LIKE));
const isMutilated = all(eq(K.reason, "replacement"), eq(K.replacementCircumstance, "mutilated"));
const isCommuterTakingUp = all(eq(K.reason, "other"), eq(K.otherReason, "commuter_status"));
const isUsAddress = (countryKey) => all(rule(countryKey, "exists"), eq(countryKey, "United States"));
const isForeignAddress = (countryKey) => all(rule(countryKey, "exists"), rule(countryKey, "not_equals", "United States"));
const physicalDiffers = (...extra) => all(eq(K.physDifferent, "yes"), ...extra);
const YES_NO = [{ label: "Yes", value: "yes" }, { label: "No", value: "no" }];

// Format rules (Question.validationRules). Evaluated server-side on submit (questionnaire.service.js validateQuestionValue) and mirrored
// in the client; an unanswered value is never judged (a gated question is simply absent).
const regex = (value, message) => ({ type: "regex", value, message, severity: "error" });
const rules = {
  aNumber: [regex("^[Aa]?-?\\d{7,9}$", "Enter your A-Number: 7 to 9 digits, optionally starting with A")],
  uscisAccount: [regex("^\\d{12}$", "The USCIS Online Account Number is 12 digits")],
  ssn: [regex("^\\d{3}-?\\d{2}-?\\d{4}$", "Enter a 9-digit Social Security Number")],
  zip: [regex("^\\d{5}(-\\d{4})?$", "Enter a 5-digit ZIP Code (or ZIP+4)")],
  name: [{ type: "maxLength", value: 60, message: "Use 60 characters or fewer", severity: "error" }],
  feet: [{ type: "min", value: 2, message: "Feet must be between 2 and 8", severity: "error" }, { type: "max", value: 8, message: "Feet must be between 2 and 8", severity: "error" }, regex("^\\d$", "Enter whole feet")],
  inches: [{ type: "min", value: 0, message: "Inches must be between 0 and 11", severity: "error" }, { type: "max", value: 11, message: "Inches must be between 0 and 11", severity: "error" }, regex("^\\d{1,2}$", "Enter whole inches")],
  weight: [{ type: "min", value: 1, message: "Enter your weight in pounds", severity: "error" }, { type: "max", value: 999, message: "Weight must be 999 pounds or less", severity: "error" }, regex("^\\d{1,3}$", "Enter whole pounds")],
  classOfAdmission: [regex("^[A-Za-z0-9-]{2,10}$", "Enter the class of admission code printed on your card (for example IR1, CR2, F21)")],
  phone: [{ type: "phone", value: 10, message: "Enter a valid phone number", severity: "error" }],
  // a date that cannot be in the future (a birth date, an admission date, the day a card went missing)
  pastDate: [{ type: "date", value: "past", message: "This date cannot be in the future", severity: "error" }],
  date: [{ type: "date", message: "Enter a valid date", severity: "error" }],
};

// One builder per section: auto-numbers the questions of that section and applies the metadata every question of this checklist carries.
//   canonicalPath    - the person.* / contact.* / immigration.* path the answer is bound to (omit for a pure gate or a file)
//   formRef          - "Part N, Item N" of the official form (omit when the form has no box for it)
//   pdf              - true when i90-crosswalk.js fills a box from this question's canonical path
//   requirement      - "required" (default) | "conditional" (default whenever conditionalLogic is given)
//   sensitive        - the answer is an identifier (SSN, A-Number ...): tagged so staff / log redaction treat it as one
//   canonicalType, normalization - what is stored and how (documentation, asserted by tests)
function section(title) {
  let order = 0;
  return (key, label, type, extras = {}) => {
    order += 1;
    const { canonicalPath, formRef, pdf, requirement, sensitive, canonicalType, normalization, ...rest } = extras;
    const metadata = {
      ...(rest.metadata || {}),
      requirement: requirement || (rest.conditionalLogic ? "conditional" : "required"),
      pdfAutofill: Boolean(pdf),
      // a choice answer must be one of the listed options (enforced server-side on submit, questionnaire.service.js validateQuestionValue)
      ...(["select", "radio", "multi_select"].includes(type) && rest.options?.length ? { strictOptions: true } : {}),
      ...(formRef ? { formRef } : {}),
      ...(canonicalType ? { canonicalType } : {}),
      ...(normalization ? { normalization } : {}),
      ...(sensitive ? { sensitive: true } : {}),
    };
    return buildQuestion(key, label, type, title, order, {
      ...rest,
      metadata,
      mapping: canonicalPath ? { canonicalPath } : undefined,
      visibility: VISIBILITY,
    });
  };
}

function reasonQuestions() {
  const q = section(SECTIONS.reason);
  return [
    q(K.reason, "I am applying for:", "select", {
      canonicalPath: "immigration.greenCard.applicationReason",
      canonicalType: "enum",
      normalization: "one of renewal | replacement | correction | biographic_update | other (internal value, never printed on the form)",
      formRef: "Part 2, Item 2 (Section A) / Item 3 (Section B)",
      pdf: true,
      description: "Choose the one that applies. You will only be asked about the reason you choose.",
      options: [
        { label: "Renewal of my Green Card because my previous card has expired or will expire within six months", value: "renewal" },
        { label: "Replacement because my Green Card was lost, stolen, destroyed, or mutilated", value: "replacement" },
        { label: "Correction of incorrect information on my Green Card that was not caused by a USCIS error, where applicable", value: "correction" },
        { label: "Update of my name or other biographic information following a legal change", value: "biographic_update" },
        { label: "Another reason allowed on Form I-90 (turned 14, commuter status, automatic conversion, an older edition of the card, or a reason not listed above)", value: "other" },
      ],
    }),
    q(K.statusType, "My status is:", "select", {
      canonicalPath: "immigration.residentStatusType",
      canonicalType: "enum",
      normalization: "lawful_permanent_resident | commuter | conditional",
      formRef: "Part 2, Item 1",
      pdf: true,
      description: "If you are a conditional permanent resident whose status expires within 90 days, do not use this application - tell your case manager.",
      options: [
        { label: "Lawful Permanent Resident", value: "lawful_permanent_resident" },
        { label: "Permanent Resident - In Commuter Status", value: "commuter" },
        { label: "Conditional Permanent Resident", value: "conditional" },
      ],
    }),

    // ── Renewal ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    q(K.cardExpiration, "Expiration date of your current Green Card", "date", {
      canonicalPath: "immigration.greenCard.expirationDate", canonicalType: "date", normalization: "ISO yyyy-mm-dd",
      description: "The 'Card Expires' date printed on the front of the card.",
      conditionalLogic: isRenewal, validationRules: rules.date,
    }),

    // ── Replacement (lost / stolen / destroyed / mutilated / never received) ──────────────────────────────────────────────────
    q(K.replacementCircumstance, "What happened to your card?", "select", {
      canonicalPath: "immigration.greenCard.replacementCircumstance", canonicalType: "enum",
      normalization: "lost | stolen | destroyed | mutilated | never_received",
      formRef: "Part 2, Items 2.a-2.c (Section A) / 3.a-3.c (Section B)", pdf: true,
      conditionalLogic: isReplacement,
      options: [
        { label: "It was lost", value: "lost" },
        { label: "It was stolen", value: "stolen" },
        { label: "It was destroyed", value: "destroyed" },
        { label: "It was mutilated (damaged)", value: "mutilated" },
        { label: "It was issued but I never received it", value: "never_received" },
      ],
    }),
    q(K.incidentDate, "Approximate date this happened", "date", {
      canonicalPath: "immigration.greenCard.incidentDate", canonicalType: "date", normalization: "ISO yyyy-mm-dd",
      description: "For a card that never arrived, the date it was issued or mailed, if you know it.",
      conditionalLogic: isLossLike, validationRules: rules.pastDate,
    }),
    q(K.incidentDescription, "Describe what happened to the card", "textarea", {
      canonicalPath: "immigration.greenCard.incidentDescription", canonicalType: "string",
      description: "Where and how the card was lost, stolen, destroyed or damaged, or what you did after it never arrived. A case manager will use this to prepare your application.",
      conditionalLogic: isReplacement,
    }),
    q(K.cardAvailable, "Do you still have the damaged card to send with your application?", "radio", {
      canonicalPath: "immigration.greenCard.cardAvailableToSubmit", canonicalType: "yes/no",
      conditionalLogic: isMutilated, options: YES_NO,
    }),

    // ── Correction ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    q(K.correctionCause, "Who caused the incorrect information on your card?", "select", {
      canonicalPath: "immigration.greenCard.correctionCause", canonicalType: "enum",
      normalization: "uscis_error | applicant_error | not_sure",
      formRef: "Part 2, Item 2.d (Section A) / 3.d (Section B)", pdf: true,
      description: "If USCIS made the error, a different (usually no-fee) correction procedure may apply - your case manager will review this before anything is filed.",
      conditionalLogic: isCorrection,
      metadata: { staffReview: { when: "uscis_error", reason: "Possible USCIS/DHS error: may follow a different correction procedure and may not need Form I-90 - confirm before filing." } },
      options: [
        { label: "USCIS (or the Department of Homeland Security) made the error", value: "uscis_error" },
        { label: "The information I gave in my original application was incorrect", value: "applicant_error" },
        { label: "I am not sure", value: "not_sure" },
      ],
    }),
    q(K.correctionItems, "Each item that is incorrect on your card", "repeating_group", {
      canonicalPath: "immigration.greenCard.corrections", canonicalType: "array<{item, incorrectValue, correctValue}>",
      description: "Add one entry for each piece of incorrect information.",
      conditionalLogic: isCorrection,
      repeatable: true,
      repeatableConfig: { min: 1, max: 10, allowClientAdd: true },
      metadata: {
        itemLabel: "Incorrect item",
        addLabel: "Add another incorrect item",
        fields: [
          { key: "item", label: "What is incorrect (for example: date of birth, spelling of name)", type: "text", required: true },
          { key: "incorrectValue", label: "What the card shows", type: "text", required: true },
          { key: "correctValue", label: "What it should show", type: "text", required: true },
        ],
      },
    }),

    // ── Update of biographic information after a legal change ──────────────────────────────────────────────────────────────────
    q(K.bioChangeType, "What information changed?", "select", {
      canonicalPath: "immigration.greenCard.biographicChange.type", canonicalType: "enum",
      normalization: "name | sex | date_of_birth | other",
      conditionalLogic: isBiographic,
      options: [
        { label: "My name", value: "name" },
        { label: "My sex", value: "sex" },
        { label: "My date of birth", value: "date_of_birth" },
        { label: "Other biographic information", value: "other" },
      ],
    }),
    q(K.bioPrevious, "Previous information (as shown on your card)", "text", {
      canonicalPath: "immigration.greenCard.biographicChange.previousValue", canonicalType: "string", conditionalLogic: isBiographic,
    }),
    q(K.bioNew, "New information", "text", {
      canonicalPath: "immigration.greenCard.biographicChange.newValue", canonicalType: "string", conditionalLogic: isBiographic,
    }),
    q(K.bioEffective, "Date the change became legal", "date", {
      canonicalPath: "immigration.greenCard.biographicChange.effectiveDate", canonicalType: "date", normalization: "ISO yyyy-mm-dd",
      conditionalLogic: isBiographic, validationRules: rules.pastDate,
    }),
    q(K.bioLegalDocument, "The legal document that shows the change", "select", {
      canonicalPath: "immigration.greenCard.biographicChange.legalDocument", canonicalType: "enum",
      normalization: "marriage_certificate | divorce_decree | court_order | amended_birth_certificate | other",
      conditionalLogic: isBiographic,
      options: [
        { label: "Marriage certificate", value: "marriage_certificate" },
        { label: "Divorce decree", value: "divorce_decree" },
        { label: "Court order (name change or other)", value: "court_order" },
        { label: "Amended birth certificate", value: "amended_birth_certificate" },
        { label: "Other legal document", value: "other" },
      ],
    }),

    // ── Another reason the form allows ────────────────────────────────────────────────────────────────────────────────────────
    q(K.otherReason, "Which reason applies?", "select", {
      canonicalPath: "immigration.greenCard.otherReason", canonicalType: "enum",
      normalization: "turned_14_expires_after_16 | turned_14_expires_before_16 | commuter_status | commuter_to_resident | automatic_conversion | prior_edition_or_other",
      formRef: "Part 2, Items 2.g-2.j", pdf: true,
      description: "These reasons are reviewed by your case manager before the application is prepared.",
      conditionalLogic: isOther,
      metadata: { staffReview: { when: "any", reason: "Client selected a non-standard Form I-90 reason - confirm eligibility and reason box before filing." } },
      options: [
        { label: "I turned 14 and am registering as required; my card expires AFTER my 16th birthday", value: "turned_14_expires_after_16" },
        { label: "I turned 14 and am registering as required; my card expires BEFORE my 16th birthday", value: "turned_14_expires_before_16" },
        { label: "I am a permanent resident who is taking up commuter status", value: "commuter_status" },
        { label: "I am a commuter who is taking up actual residence in the United States", value: "commuter_to_resident" },
        { label: "I have been automatically converted to lawful permanent resident status", value: "automatic_conversion" },
        { label: "I have a prior edition of the card, or my reason is not listed", value: "prior_edition_or_other" },
      ],
    }),
    q(K.commuterPoeCity, "Port of entry you will use - City or Town", "text", {
      canonicalPath: "immigration.commuterPortOfEntry.city", canonicalType: "string", formRef: "Part 2, Item 2.h.1.a", pdf: true,
      conditionalLogic: isCommuterTakingUp,
    }),
    q(K.commuterPoeState, "Port of entry you will use - State", "select", {
      canonicalPath: "immigration.commuterPortOfEntry.state", canonicalType: "string", normalization: "2-letter US state code, upper-case",
      formRef: "Part 2, Item 2.h.1.a", pdf: true, options: US_STATES, conditionalLogic: isCommuterTakingUp,
    }),
  ];
}

function identityQuestions() {
  const q = section(SECTIONS.identity);
  const colorOption = (label) => ({ label, value: label.toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "") });
  return [
    q(K.aNumber, "A-Number (Alien Registration Number)", "text", {
      canonicalPath: "person.alienNumber", canonicalType: "string", normalization: "canonical form A + digits; the form widget pre-prints 'A-', so only the digits are printed",
      formRef: "Part 1, Item 1", pdf: true, sensitive: true, validationRules: rules.aNumber,
      description: "The 9-digit number on your Green Card (it may start with an A).",
    }),
    q(K.hasAccount, "Do you have a USCIS Online Account Number?", "radio", {
      canonicalPath: "person.uscisAccountProvided", canonicalType: "yes/no", options: YES_NO,
    }),
    q(K.account, "USCIS Online Account Number", "text", {
      canonicalPath: "person.uscisOnlineAccountNumber", canonicalType: "string", normalization: "12 digits",
      formRef: "Part 1, Item 2", pdf: true, sensitive: true, validationRules: rules.uscisAccount,
      conditionalLogic: all(eq(K.hasAccount, "yes")),
    }),
    q(K.hasSsn, "Do you have a U.S. Social Security Number?", "radio", {
      canonicalPath: "person.ssnProvided", canonicalType: "yes/no", options: YES_NO,
    }),
    q(K.ssn, "U.S. Social Security Number", "text", {
      canonicalPath: "person.ssn", canonicalType: "string", normalization: "9 digits; the form prints digits only",
      formRef: "Part 1, Item 16", pdf: true, sensitive: true, validationRules: rules.ssn,
      conditionalLogic: all(eq(K.hasSsn, "yes")),
    }),
    q(K.lastName, "Family Name (Last Name)", "text", {
      canonicalPath: "person.lastName", canonicalType: "string", normalization: "trimmed, Title-Cased",
      formRef: "Part 1, Item 3.a", pdf: true, validationRules: rules.name,
      description: "Your full legal name - your card will be issued in this name.",
    }),
    q(K.firstName, "Given Name (First Name)", "text", {
      canonicalPath: "person.firstName", canonicalType: "string", normalization: "trimmed, Title-Cased",
      formRef: "Part 1, Item 3.b", pdf: true, validationRules: rules.name,
    }),
    q(K.hasMiddle, "Do you have a middle name?", "radio", {
      canonicalPath: "person.middleNameProvided", canonicalType: "yes/no", options: YES_NO,
    }),
    q(K.middleName, "Middle Name", "text", {
      canonicalPath: "person.middleName", canonicalType: "string", normalization: "trimmed, Title-Cased",
      formRef: "Part 1, Item 3.c", pdf: true, validationRules: rules.name,
      conditionalLogic: all(eq(K.hasMiddle, "yes")),
    }),
    q(K.nameChanged, "Has your name legally changed since your Green Card was issued?", "radio", {
      canonicalPath: "person.nameChangedSinceCardIssuance", canonicalType: "enum", normalization: "yes | no | never_received",
      formRef: "Part 1, Item 4", pdf: true,
      options: [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
        { label: "Not applicable - I never received my previous card", value: "never_received" },
      ],
    }),
    q(K.cardLast, "Family Name (Last Name) exactly as printed on your current card", "text", {
      canonicalPath: "person.nameOnCard.lastName", canonicalType: "string", formRef: "Part 1, Item 5.a", pdf: true, validationRules: rules.name,
      conditionalLogic: all(eq(K.nameChanged, "yes")),
    }),
    q(K.cardFirst, "Given Name (First Name) exactly as printed on your current card", "text", {
      canonicalPath: "person.nameOnCard.firstName", canonicalType: "string", formRef: "Part 1, Item 5.b", pdf: true, validationRules: rules.name,
      conditionalLogic: all(eq(K.nameChanged, "yes")),
    }),
    q(K.cardHasMiddle, "Does your current card show a middle name?", "radio", {
      canonicalPath: "person.nameOnCard.middleNameProvided", canonicalType: "yes/no", options: YES_NO,
      conditionalLogic: all(eq(K.nameChanged, "yes")),
    }),
    q(K.cardMiddle, "Middle Name exactly as printed on your current card", "text", {
      canonicalPath: "person.nameOnCard.middleName", canonicalType: "string", formRef: "Part 1, Item 5.c", pdf: true, validationRules: rules.name,
      conditionalLogic: all(eq(K.nameChanged, "yes"), eq(K.cardHasMiddle, "yes")),
    }),
    q(K.sex, "Sex", "select", {
      canonicalPath: "person.gender", canonicalType: "enum", normalization: "canonical profile stores male | female",
      formRef: "Part 1, Item 8", pdf: true,
      options: [{ label: "Male", value: "Male" }, { label: "Female", value: "Female" }],
    }),
    q(K.dob, "Date of Birth", "date", {
      canonicalPath: "person.dob", canonicalType: "date", normalization: "ISO yyyy-mm-dd",
      formRef: "Part 1, Item 9", pdf: true, validationRules: rules.pastDate,
    }),
    q(K.cityOfBirth, "City/Town/Village of Birth", "text", {
      canonicalPath: "person.cityTownOfBirth", canonicalType: "string", formRef: "Part 1, Item 10", pdf: true,
    }),
    q(K.countryOfBirth, "Country of Birth", "select", {
      canonicalPath: "person.countryOfBirth", canonicalType: "string", formRef: "Part 1, Item 11", pdf: true, options: COUNTRIES,
    }),
    q(K.mother, "Mother's Given Name (First Name)", "text", {
      canonicalPath: "person.mother.firstName", canonicalType: "string", formRef: "Part 1, Item 12", pdf: true, validationRules: rules.name,
      description: "If you do not know it, type Unknown.",
    }),
    q(K.father, "Father's Given Name (First Name)", "text", {
      canonicalPath: "person.father.firstName", canonicalType: "string", formRef: "Part 1, Item 13", pdf: true, validationRules: rules.name,
      description: "If you do not know it, type Unknown.",
    }),
    q(K.ethnicity, "Ethnicity", "radio", {
      canonicalPath: "person.ethnicity", canonicalType: "enum", normalization: "hispanic_or_latino | not_hispanic_or_latino",
      formRef: "Part 3, Item 6", pdf: true,
      options: [{ label: "Hispanic or Latino", value: "hispanic_or_latino" }, { label: "Not Hispanic or Latino", value: "not_hispanic_or_latino" }],
    }),
    q(K.race, "Race (select all that apply)", "multi_select", {
      canonicalPath: "person.race", canonicalType: "array<enum>", formRef: "Part 3, Item 7", pdf: true,
      options: [
        { label: "White", value: "white" },
        { label: "Asian", value: "asian" },
        { label: "Black or African American", value: "black_or_african_american" },
        { label: "American Indian or Alaska Native", value: "american_indian_or_alaska_native" },
        { label: "Native Hawaiian or Other Pacific Islander", value: "native_hawaiian_or_other_pacific_islander" },
      ],
    }),
    q(K.heightFeet, "Height - Feet", "number", {
      canonicalPath: "person.height.feet", canonicalType: "integer 2-8", formRef: "Part 3, Item 8", pdf: true, validationRules: rules.feet,
    }),
    q(K.heightInches, "Height - Inches", "number", {
      canonicalPath: "person.height.inches", canonicalType: "integer 0-11", formRef: "Part 3, Item 8", pdf: true, validationRules: rules.inches,
    }),
    q(K.weight, "Weight in Pounds", "number", {
      canonicalPath: "person.weightPounds", canonicalType: "integer 1-999", normalization: "printed as three digits, zero-padded on the left",
      formRef: "Part 3, Item 9", pdf: true, validationRules: rules.weight,
    }),
    q(K.eye, "Eye Color", "select", {
      canonicalPath: "person.eyeColor", canonicalType: "enum", formRef: "Part 3, Item 10", pdf: true,
      options: ["Black", "Blue", "Brown", "Gray", "Green", "Hazel", "Maroon", "Pink", "Unknown / Other"].map(colorOption),
    }),
    q(K.hair, "Hair Color", "select", {
      canonicalPath: "person.hairColor", canonicalType: "enum", formRef: "Part 3, Item 11", pdf: true,
      options: ["Bald (No hair)", "Black", "Blond", "Brown", "Gray", "Red", "Sandy", "White", "Unknown / Other"].map(colorOption),
    }),
  ];
}

// One mailing / physical address block. `p` carries the key set and canonical paths of the block.
function addressBlock(q, p, { gate, formPart, pdf }) {
  const withGate = (extra = {}) => ({ ...extra, ...(gate ? { conditionalLogic: extra.conditionalLogic || gate } : {}) });
  const both = (...rulesList) => (gate ? all(...gate.rules, ...rulesList) : all(...rulesList));
  return [
    q(p.street, "Street Number and Name", "text", withGate({ canonicalPath: p.line1, canonicalType: "string", formRef: `${formPart}.b`, pdf })),
    q(p.unitType, "Apartment, Suite or Floor?", "select", withGate({
      canonicalPath: p.unitTypePath, canonicalType: "enum", normalization: "none | apartment | suite | floor", formRef: `${formPart}.c`, pdf,
      options: [{ label: "None", value: "none" }, { label: "Apartment", value: "apartment" }, { label: "Suite", value: "suite" }, { label: "Floor", value: "floor" }],
    })),
    q(p.unitNumber, "Apartment, Suite or Floor Number", "text", {
      canonicalPath: p.line2, canonicalType: "string", formRef: `${formPart}.c`, pdf,
      conditionalLogic: both(oneOf(p.unitType, ["apartment", "suite", "floor"])),
    }),
    q(p.city, "City or Town", "text", withGate({ canonicalPath: p.cityPath, canonicalType: "string", formRef: `${formPart}.d`, pdf })),
    q(p.country, "Country", "select", withGate({ canonicalPath: p.countryPath, canonicalType: "string", formRef: `${formPart}.i`, pdf, options: COUNTRIES })),
    q(p.state, "State", "select", {
      canonicalPath: p.statePath, canonicalType: "string", normalization: "2-letter US state code, upper-case", formRef: `${formPart}.e`, pdf, options: US_STATES,
      conditionalLogic: both(...isUsAddress(p.country).rules),
    }),
    q(p.zip, "ZIP Code", "text", {
      canonicalPath: p.zipPath, canonicalType: "string", formRef: `${formPart}.f`, pdf, validationRules: rules.zip,
      conditionalLogic: both(...isUsAddress(p.country).rules),
    }),
    q(p.province, "Province", "text", {
      canonicalPath: p.provincePath, canonicalType: "string", formRef: `${formPart}.g`, pdf,
      conditionalLogic: both(...isForeignAddress(p.country).rules),
    }),
    q(p.postal, "Postal Code", "text", {
      canonicalPath: p.postalPath, canonicalType: "string", formRef: `${formPart}.h`, pdf,
      conditionalLogic: both(...isForeignAddress(p.country).rules),
    }),
  ];
}

function addressQuestions() {
  const q = section(SECTIONS.address);
  // Mailing questions are labelled so the client can tell the two blocks apart.
  const labelled = (questions, prefix) => questions.map((question) => ({ ...question, label: `${prefix} - ${question.label}` }));
  // Display order == call order: mailing block, the "physical address different?" toggle, the physical block, then phone and email.
  const mailing = labelled(addressBlock(q, {
    street: K.mailStreet, unitType: K.mailUnitType, unitNumber: K.mailUnitNumber, city: K.mailCity, country: K.mailCountry, state: K.mailState,
    zip: K.mailZip, province: K.mailProvince, postal: K.mailPostal,
    line1: "contact.address.line1", unitTypePath: "contact.address.unitType", line2: "contact.address.line2", cityPath: "contact.address.city",
    countryPath: "contact.address.country", statePath: "contact.address.state", zipPath: "contact.address.zip",
    provincePath: "contact.address.province", postalPath: "contact.address.postalCode",
  }, { gate: null, formPart: "Part 1, Item 6", pdf: true }), "Mailing Address");
  const differs = q(K.physDifferent, "Is your physical address different from your mailing address?", "radio", {
    canonicalPath: "contact.physicalAddressDifferent", canonicalType: "yes/no", normalization: "the physical address is printed only while this is yes",
    formRef: "Part 1, Item 7", pdf: true, options: YES_NO,
  });
  const physical = labelled(addressBlock(q, {
    street: K.physStreet, unitType: K.physUnitType, unitNumber: K.physUnitNumber, city: K.physCity, country: K.physCountry, state: K.physState,
    zip: K.physZip, province: K.physProvince, postal: K.physPostal,
    line1: "contact.physicalAddress.line1", unitTypePath: "contact.physicalAddress.unitType", line2: "contact.physicalAddress.line2",
    cityPath: "contact.physicalAddress.city", countryPath: "contact.physicalAddress.country", statePath: "contact.physicalAddress.state",
    zipPath: "contact.physicalAddress.zip", provincePath: "contact.physicalAddress.province", postalPath: "contact.physicalAddress.postalCode",
  }, { gate: all(eq(K.physDifferent, "yes")), formPart: "Part 1, Item 7", pdf: true }), "Physical Address");
  return [
    ...mailing,
    differs,
    ...physical,
    q(K.phone, "Daytime Telephone Number", "phone", {
      canonicalPath: "contact.phone", canonicalType: "string", normalization: "digits (and a leading +)", formRef: "Part 5, Item 3", pdf: true, validationRules: rules.phone,
    }),
    q(K.email, "Email Address", "email", {
      canonicalPath: "contact.email", canonicalType: "string", normalization: "lower-case", formRef: "Part 5, Item 5", pdf: true,
    }),
  ];
}

function residenceQuestions() {
  const q = section(SECTIONS.residence);
  const byVisa = all(eq(K.greenCardPath, "immigrant_visa"));
  return [
    q(K.classOfAdmission, "Class of Admission", "text", {
      canonicalPath: "immigration.classOfAdmission", canonicalType: "string", normalization: "upper-case code printed on the card",
      formRef: "Part 1, Item 14", pdf: true, validationRules: rules.classOfAdmission,
      description: "The code on the front of your card, such as IR1, CR1, F21 or EB2.",
    }),
    q(K.dateOfAdmission, "Date of Admission (or the date adjustment of status was granted)", "date", {
      canonicalPath: "immigration.dateOfAdmission", canonicalType: "date", normalization: "ISO yyyy-mm-dd",
      formRef: "Part 1, Item 15", pdf: true, validationRules: rules.pastDate,
      description: "The 'Resident Since' date on your card.",
    }),
    q(K.greenCardPath, "How did you become a permanent resident?", "radio", {
      canonicalPath: "immigration.greenCardPath", canonicalType: "enum", normalization: "immigrant_visa | adjustment_of_status",
      formRef: "Part 3, Items 3.a-3.a.1", pdf: true,
      options: [
        { label: "I entered the United States with an immigrant visa", value: "immigrant_visa" },
        { label: "I was granted adjustment of status inside the United States", value: "adjustment_of_status" },
      ],
    }),
    q(K.appliedLocation, "Location where you applied for an immigrant visa or adjustment of status", "text", {
      canonicalPath: "immigration.greenCardApplicationLocation", canonicalType: "string", formRef: "Part 3, Item 1", pdf: true,
      description: "The city (and country, for a visa) of the U.S. consulate or the USCIS office.",
    }),
    q(K.issuedLocation, "Location where your immigrant visa was issued, or the USCIS office where you were granted adjustment of status", "text", {
      canonicalPath: "immigration.cardIssuanceLocation", canonicalType: "string", formRef: "Part 3, Item 2", pdf: true,
    }),
    q(K.destination, "Destination in the United States at the time of admission", "text", {
      canonicalPath: "immigration.destinationAtAdmission", canonicalType: "string", formRef: "Part 3, Item 3.a", pdf: true, conditionalLogic: byVisa,
      description: "Where you said you were going when you entered with your immigrant visa.",
    }),
    q(K.poeCity, "Port of Entry where you were admitted to the United States - City or Town", "text", {
      canonicalPath: "immigration.portOfEntry.city", canonicalType: "string", formRef: "Part 3, Item 3.a.1", pdf: true, conditionalLogic: byVisa,
    }),
    q(K.poeState, "Port of Entry where you were admitted to the United States - State", "select", {
      canonicalPath: "immigration.portOfEntry.state", canonicalType: "string", normalization: "2-letter US state code, upper-case",
      formRef: "Part 3, Item 3.a.1", pdf: true, options: US_STATES, conditionalLogic: byVisa,
    }),
    q(K.removal, "Have you ever been in exclusion, deportation, or removal proceedings, or ordered removed from the United States?", "radio", {
      canonicalPath: "immigration.removalProceedings", canonicalType: "yes/no", formRef: "Part 3, Item 4", pdf: true, options: YES_NO,
      metadata: { staffReview: { when: "yes", reason: "Applicant reports removal proceedings - attorney review recommended before filing." } },
    }),
    q(K.removalExplanation, "Explain the exclusion, deportation or removal proceedings", "textarea", {
      canonicalPath: "immigration.removalProceedingsExplanation", canonicalType: "string", formRef: "Part 8, Additional Information", pdf: true,
      conditionalLogic: all(eq(K.removal, "yes")),
    }),
    q(K.abandonment, "Since you became a permanent resident, have you ever filed Form I-407 (Abandonment of Lawful Permanent Resident Status), or been determined to have abandoned your status?", "radio", {
      canonicalPath: "immigration.abandonmentDetermination", canonicalType: "yes/no", formRef: "Part 3, Item 5", pdf: true, options: YES_NO,
      metadata: { staffReview: { when: "yes", reason: "Applicant reports an I-407 or abandonment determination - attorney review recommended before filing." } },
    }),
    q(K.abandonmentExplanation, "Explain the Form I-407 filing or abandonment determination", "textarea", {
      canonicalPath: "immigration.abandonmentExplanation", canonicalType: "string", formRef: "Part 8, Additional Information", pdf: true,
      conditionalLogic: all(eq(K.abandonment, "yes")),
    }),
  ];
}

function accommodationQuestions() {
  const q = section(SECTIONS.accommodations);
  const requested = all(eq(K.accommodation, "yes"));
  const withType = (value) => all(eq(K.accommodation, "yes"), rule(K.accommodationTypes, "contains", value));
  return [
    q(K.accommodation, "Are you requesting an accommodation because of a disability or impairment?", "radio", {
      canonicalPath: "person.accommodation.requested", canonicalType: "yes/no", formRef: "Part 4, Item 1", pdf: true, options: YES_NO,
    }),
    q(K.accommodationTypes, "Which of these apply to you?", "multi_select", {
      canonicalPath: "person.accommodation.types", canonicalType: "array<enum>", formRef: "Part 4, Items 1.a-1.c", pdf: true,
      conditionalLogic: requested,
      options: [
        { label: "I am deaf or hard of hearing", value: "deaf_or_hard_of_hearing" },
        { label: "I am blind or have low vision", value: "blind_or_low_vision" },
        { label: "I have another type of disability or impairment", value: "other" },
      ],
    }),
    q(K.deafDetails, "The accommodation you are requesting (for a sign-language interpreter, name the language)", "textarea", {
      canonicalPath: "person.accommodation.deafDetails", canonicalType: "string", formRef: "Part 4, Item 1.a", pdf: true,
      conditionalLogic: withType("deaf_or_hard_of_hearing"),
    }),
    q(K.blindDetails, "The accommodation you are requesting", "textarea", {
      canonicalPath: "person.accommodation.blindDetails", canonicalType: "string", formRef: "Part 4, Item 1.b", pdf: true,
      conditionalLogic: withType("blind_or_low_vision"),
    }),
    q(K.otherDetails, "Describe your disability or impairment and the accommodation you are requesting", "textarea", {
      canonicalPath: "person.accommodation.otherDetails", canonicalType: "string", formRef: "Part 4, Item 1.c", pdf: true,
      conditionalLogic: withType("other"),
    }),
  ];
}

// Documents. Every one is a `file` question with its own documentType, so uploads become Document records of this case (category below is
// a Document.categories value). Only the passport is unconditional - and therefore the only one copied onto the case as a standing
// "Required Document"; every other one is shown, and owed, only while its gate holds. Tax returns and other extra evidence are deliberately
// NOT standing questions: the I-90 does not require them, and a case manager asks for them case by case through "Additional Requested
// Information" (information-requests), which is never gated.
function documentQuestions() {
  const q = section(SECTIONS.documents);
  const doc = (key, name, category, extras = {}) => q(key, name, "file", {
    evidenceCategory: category,
    ...extras,
    metadata: { documentType: key, category, ...(extras.metadata || {}) },
  });
  return [
    doc("i90_doc_passport", "Copy of your passport (the page with your photo)", "identity", {
      requirement: "required", description: "A government-issued photo identity document. Your passport is preferred.",
    }),
    q(K.hasPreviousCard, "Do you have your previous Permanent Resident Card (or a copy of it)?", "radio", { canonicalPath: "immigration.greenCard.previousCardAvailable", canonicalType: "yes/no", options: YES_NO }),
    doc("i90_doc_previousGreenCard", "Copy of your previous Permanent Resident Card (front and back)", "immigration", {
      conditionalLogic: all(eq(K.hasPreviousCard, "yes")),
      description: "If your card is mutilated or has incorrect information, the original card must be sent with the application - your case manager will explain how.",
    }),
    q(K.hasStateId, "Do you have a driver's license or state identification card?", "radio", { canonicalPath: "person.stateIdentificationAvailable", canonicalType: "yes/no", options: YES_NO }),
    doc("i90_doc_stateId", "Copy of your driver's license or state identification card", "identity", { conditionalLogic: all(eq(K.hasStateId, "yes")) }),
    doc("i90_doc_ssnEvidence", "Evidence of your Social Security Number (Social Security card or other record)", "identity", {
      conditionalLogic: all(eq(K.hasSsn, "yes")),
    }),
    doc("i90_doc_birthCertificate", "Copy of your birth certificate", "civil", {
      conditionalLogic: any(eq(K.reason, "correction"), eq(K.reason, "biographic_update")),
      description: "Needed when the correction or update concerns your name, date or place of birth.",
    }),
    doc("i90_doc_legalChangeEvidence", "Evidence of the legal name or biographic information change (court order, marriage certificate, divorce decree, amended certificate)", "civil", {
      conditionalLogic: any(eq(K.reason, "biographic_update"), eq(K.nameChanged, "yes")),
    }),
    doc("i90_doc_lossEvidence", "Evidence that the card was lost, stolen, destroyed or never received (for example a police report or a written statement)", "evidence", {
      conditionalLogic: isLossLike,
    }),
    doc("i90_doc_correctionEvidence", "Documents that show the correct information", "evidence", { conditionalLogic: isCorrection }),
    doc("i90_doc_otherReasonEvidence", "Evidence supporting your reason (for example proof of age, commuter status or automatic conversion)", "supporting", {
      conditionalLogic: isOther,
    }),
  ];
}

function buildGreenCardRenewalChecklist() {
  const questions = [
    ...reasonQuestions(),
    ...identityQuestions(),
    ...addressQuestions(),
    ...residenceQuestions(),
    ...accommodationQuestions(),
    ...documentQuestions(),
  ];
  return {
    key: "green_card_renewal_checklist",
    title: TITLE,
    visaType: "GreenCardRenewal",
    checklistRole: "client",
    isDefault: true,
    // The stored questionnaire predates this definition (older title / metadata) - ask reconcileDefinition to bring those identity fields
    // up to date in place (it never touches an archived questionnaire and never recreates one).
    reconcileMetadata: true,
    description: "",
    sections: Object.values(SECTIONS),
    questions,
  };
}

const GREEN_CARD_RENEWAL_DEFINITIONS = [buildGreenCardRenewalChecklist()];

module.exports = { GREEN_CARD_RENEWAL_DEFINITIONS, buildGreenCardRenewalChecklist, SECTIONS, TITLE, K, slugSection };
