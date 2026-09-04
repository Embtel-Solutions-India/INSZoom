// Seed data for the VisaFormMapping registry - transcribed faithfully from
// the approved business mapping table (the task's own Section 6 spec is
// the business input; this file implements it, it does not invent
// immigration policy - see corrections §14). Real form numbers only;
// components/supplements use parentForm+componentType rather than
// invented standalone form numbers (§4).
//
// sourceVerified is set true only where independently spot-checked against
// an authoritative source during this implementation (recorded in
// verificationSource/verificationDate below); everything else is
// sourceVerified:false with notes, and is listed as such in the final
// report - never silently promoted to verified.

const AUTO = "AUTO_CREATE";
const COND = "CONDITIONAL";
const LATER = "LATER_STAGE";
const REF = "REFERENCE";

const STANDALONE = "STANDALONE_FORM";
const SUPPLEMENT = "SUPPLEMENT";
const ONLINE = "ONLINE_APPLICATION";
const GOVDOC = "GOVERNMENT_DOCUMENT";
const REFDOC = "REFERENCE_DOCUMENT";

const NONIMMIGRANT = "TEMPORARY_NONIMMIGRANT";
const IMMIGRANT = "PERMANENT_IMMIGRANT";

let order = 0;
function m(visaType, formNumber, formName, agency, provisioningType, componentType, opts = {}) {
  order += 1;
  return {
    visaType,
    visaCategory: opts.visaCategory ?? visaType,
    caseType: opts.caseType ?? "immigration",
    immigrationNature: opts.immigrationNature ?? NONIMMIGRANT,
    formNumber,
    formName,
    agency,
    provisioningType,
    processingPaths: opts.processingPaths ?? [],
    triggerCondition: opts.triggerCondition ?? null,
    initialCaseCreation: opts.initialCaseCreation ?? (provisioningType === AUTO_CREATE_ALIAS(provisioningType)),
    stage: opts.stage ?? "",
    parentForm: opts.parentForm ?? null,
    componentType,
    formTemplateFormCode: opts.formTemplateFormCode ?? null,
    displayOrder: order,
    active: true,
    sourceVerified: opts.sourceVerified ?? false,
    verificationSource: opts.verificationSource ?? "",
    verificationDate: opts.verificationDate ?? null,
    notes: opts.notes ?? "",
  };
}
function AUTO_CREATE_ALIAS(t) { return t === AUTO ? AUTO : "__never__"; }

// --- Repeated shape helpers -------------------------------------------
function i129Petition(visaType, opts = {}) {
  return m(visaType, "I-129", "Petition for a Nonimmigrant Worker", "USCIS", opts.provisioningType || AUTO, STANDALONE, { formTemplateFormCode: "i-129", initialCaseCreation: true, ...opts });
}
function i129HSupplement(visaType, opts = {}) {
  return m(visaType, "I-129 H Classification Supplement", "H Classification Supplement to Form I-129", "USCIS", AUTO, SUPPLEMENT, { parentForm: "I-129", initialCaseCreation: true, notes: "Part of the I-129 filing package, not a standalone form.", ...opts });
}
function i129OPSupplement(visaType, opts = {}) {
  return m(visaType, "I-129 O/P Classification Supplement", "O/P Classification Supplement to Form I-129", "USCIS", AUTO, SUPPLEMENT, { parentForm: "I-129", initialCaseCreation: true, notes: "Part of the I-129 filing package, not a standalone form.", ...opts });
}
function i129LSupplement(visaType, opts = {}) {
  return m(visaType, "I-129 L Classification Supplement", "L Classification Supplement to Form I-129", "USCIS", AUTO, SUPPLEMENT, { parentForm: "I-129", initialCaseCreation: true, notes: "Part of the I-129 filing package, not a standalone form.", ...opts });
}
function i129QSupplement(visaType, opts = {}) {
  return m(visaType, "I-129 Q Classification Supplement", "Q Classification Supplement to Form I-129", "USCIS", AUTO, SUPPLEMENT, { parentForm: "I-129", initialCaseCreation: true, ...opts });
}
function i129RSupplement(visaType, opts = {}) {
  return m(visaType, "I-129 R Classification Supplement", "R Classification Supplement to Form I-129", "USCIS", AUTO, SUPPLEMENT, { parentForm: "I-129", initialCaseCreation: true, ...opts });
}
function i129ESupplement(visaType, opts = {}) {
  return m(visaType, "I-129 E Classification Supplement", "E Classification Supplement to Form I-129", "USCIS", COND, SUPPLEMENT, { parentForm: "I-129", notes: "Only when the USCIS COS/extension route (I-129) is used, not for consular E processing (DS-160/DS-156E).", ...opts });
}
function ds160(visaType, opts = {}) {
  return m(visaType, "DS-160", "Online Nonimmigrant Visa Application", "DOS", opts.provisioningType || COND, ONLINE, {
    processingPaths: opts.provisioningType === AUTO ? [] : ["CONSULAR"],
    initialCaseCreation: opts.provisioningType === AUTO,
    notes: "DOS online application, never a USCIS form; NOT_APPLICABLE for a pure in-country USCIS COS/extension case with no consular component.",
    ...opts,
  });
}
function i539(visaType, opts = {}) {
  return m(visaType, "I-539", "Application to Extend/Change Nonimmigrant Status", "USCIS", COND, STANDALONE, {
    processingPaths: ["CHANGE_OF_STATUS", "EXTENSION_OF_STATUS"],
    formTemplateFormCode: "i-539",
    notes: "Never auto-created for a nonimmigrant case merely by visa type - gated on processingPath.",
    ...opts,
  });
}
function i539A(visaType, opts = {}) {
  return m(visaType, "I-539A", "Supplemental Information for Application to Extend/Change Nonimmigrant Status", "USCIS", COND, SUPPLEMENT, { parentForm: "I-539", formTemplateFormCode: "i-539a", notes: "Only when a qualifying co-applicant/dependent is included on the I-539.", ...opts });
}
function i907(visaType, opts = {}) {
  // Deliberately NO triggerCondition: per spec §1/§15, I-907 must always be
  // OFFERED to the Case Manager to decide on ("Ask: Does this case require
  // Premium Processing?") - the CM's own ADD/NOT_APPLICABLE decision is the
  // gate, not a pre-existing case attribute. Gating the mapping's own
  // visibility on a data flag would mean the CM is never even asked unless
  // something else already set that flag true, defeating the "ask" UX.
  return m(visaType, "I-907", "Request for Premium Processing Service", "USCIS", COND, STANDALONE, { formTemplateFormCode: "i-907", notes: "Never universally auto-created - always offered as a Case Manager decision, never auto-created by a data flag alone.", ...opts });
}
function g28(visaType, opts = {}) {
  return m(visaType, "G-28", "Notice of Entry of Appearance as Attorney or Accredited Representative", "USCIS", COND, STANDALONE, { triggerCondition: { field: "attorneyOnRecord", operator: "equals", value: true }, formTemplateFormCode: "g-28", notes: "Also handled today by the pre-existing hardcoded resolveConditionalTemplates() path (not migrated/removed in this phase); this registry entry documents the same rule generically.", ...opts });
}
function i765(visaType, opts = {}) {
  return m(visaType, "I-765", "Application for Employment Authorization", "USCIS", opts.provisioningType || COND, STANDALONE, { formTemplateFormCode: "i-765", notes: "Requires an eligible category AND an explicit employment-authorization request - never universal.", ...opts });
}
function i131(visaType, opts = {}) {
  return m(visaType, "I-131", "Application for Travel Documents, Parole Documents, and Arrival/Departure Records", "USCIS", COND, STANDALONE, { formTemplateFormCode: "i-131", notes: "Never universal - requires an applicable travel-document/parole workflow to be selected. Distinct from being a visa classification itself.", ...opts });
}
function i485(visaType, opts = {}) {
  return m(visaType, "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", COND, STANDALONE, { processingPaths: ["ADJUSTMENT_OF_STATUS"], formTemplateFormCode: "i-485", immigrationNature: IMMIGRANT, notes: "Never auto-created merely for an immigrant case - gated on processingPath=ADJUSTMENT_OF_STATUS.", ...opts });
}
function ds260(visaType, opts = {}) {
  return m(visaType, "DS-260", "Immigrant Visa Electronic Application", "DOS", opts.provisioningType || COND, ONLINE, { processingPaths: opts.provisioningType === AUTO ? [] : ["CONSULAR", "NVC"], immigrationNature: IMMIGRANT, notes: "Never created for an AOS-only case - the immigrant visa application, gated on consular/NVC processing.", ...opts });
}
function i693(visaType, opts = {}) {
  return m(visaType, "I-693", "Report of Immigration Medical Examination and Vaccination Record", "USCIS", COND, STANDALONE, { processingPaths: ["ADJUSTMENT_OF_STATUS"], immigrationNature: IMMIGRANT, notes: "AOS medical requirement, conditional.", ...opts });
}

const mappings = [];
const add = (...items) => mappings.push(...items);

// ===================== H FAMILY =====================
add(
  i129Petition("H-1B", { verificationSource: "uscis.gov/i-129", verificationDate: new Date(), sourceVerified: true }),
  i129HSupplement("H-1B"),
  m("H-1B", "H-1B Data Collection and Filing Fee Exemption Supplement", "H-1B Data Collection and Filing Fee Exemption Supplement", "USCIS", AUTO, SUPPLEMENT, { parentForm: "I-129", initialCaseCreation: true, notes: "Part of the I-129 filing package for H-1B/H-1B1." }),
  m("H-1B", "ETA-9035", "Labor Condition Application for Nonimmigrant Workers", "DOL", AUTO, ONLINE, { initialCaseCreation: true, notes: "LCA - includes the ETA-9035E electronic filing variant of the same DOL application." }),
  ds160("H-1B"),
  i539("H-1B"),
  i907("H-1B"),
  g28("H-1B")
);

add(
  i129Petition("H-1B1 Chile", { provisioningType: COND, initialCaseCreation: false, notes: "Only where the USCIS COS/extension route applies; H-1B1 is more commonly filed via consular DS-160, not I-129." }),
  m("H-1B1 Chile", "H-1B Data Collection and Filing Fee Exemption Supplement", "H-1B Data Collection and Filing Fee Exemption Supplement", "USCIS", COND, SUPPLEMENT, { parentForm: "I-129", notes: "Only when I-129 is actually used for this H-1B1 case." }),
  m("H-1B1 Chile", "ETA-9035", "Labor Condition Application for Nonimmigrant Workers", "DOL", AUTO, ONLINE, { initialCaseCreation: true }),
  ds160("H-1B1 Chile", { provisioningType: AUTO, initialCaseCreation: true, notes: "Consular visa route is the typical H-1B1 path." }),
  i907("H-1B1 Chile")
);
add(
  i129Petition("H-1B1 Singapore", { provisioningType: COND, initialCaseCreation: false }),
  m("H-1B1 Singapore", "H-1B Data Collection and Filing Fee Exemption Supplement", "H-1B Data Collection and Filing Fee Exemption Supplement", "USCIS", COND, SUPPLEMENT, { parentForm: "I-129" }),
  m("H-1B1 Singapore", "ETA-9035", "Labor Condition Application for Nonimmigrant Workers", "DOL", AUTO, ONLINE, { initialCaseCreation: true }),
  ds160("H-1B1 Singapore", { provisioningType: AUTO, initialCaseCreation: true }),
  i907("H-1B1 Singapore")
);

add(
  i129Petition("H-2A"),
  i129HSupplement("H-2A"),
  m("H-2A", "ETA-790/790A", "Agricultural and Food Processing Clearance Order", "DOL", LATER, ONLINE, { stage: "labor_certification", notes: "Labor-certification-stage document, not created at initial case creation." }),
  m("H-2A", "ETA-9142A", "H-2A Application for Temporary Employment Certification", "DOL", LATER, ONLINE, { stage: "labor_certification" }),
  ds160("H-2A"),
  i539("H-2A"),
  i907("H-2A")
);

add(
  i129Petition("H-2B"),
  i129HSupplement("H-2B"),
  m("H-2B", "ETA-9142B", "H-2B Application for Temporary Employment Certification", "DOL", LATER, ONLINE, { stage: "labor_certification" }),
  m("H-2B", "ETA-9141", "Application for Prevailing Wage Determination", "DOL", COND, ONLINE, { stage: "labor_certification", notes: "PWD, only where applicable to the case's labor-certification workflow." }),
  ds160("H-2B"),
  i539("H-2B"),
  i907("H-2B")
);

add(
  i129Petition("H-3"),
  i129HSupplement("H-3"),
  ds160("H-3"),
  i539("H-3"),
  i907("H-3")
);

add(
  i539("H-4"),
  i539A("H-4"),
  m("H-4", "I-765", "Application for Employment Authorization", "USCIS", COND, STANDALONE, { triggerCondition: { field: "caseType", operator: "equals", value: "immigration" }, formTemplateFormCode: "i-765", notes: "H-4 EAD eligibility - conditional, not automatic." }),
  ds160("H-4")
);

// ===================== L FAMILY =====================
add(i129Petition("L-1A"), i129LSupplement("L-1A"), m("L-1A", "I-129S", "Nonimmigrant Petition Based on Blanket L Petition", "USCIS", COND, STANDALONE, { notes: "Blanket L petition workflow only." }), ds160("L-1A"), i539("L-1A"), i907("L-1A"));
add(i129Petition("L-1B"), i129LSupplement("L-1B"), m("L-1B", "I-129S", "Nonimmigrant Petition Based on Blanket L Petition", "USCIS", COND, STANDALONE, { notes: "Blanket L petition workflow only." }), ds160("L-1B"), i907("L-1B"));
add(i539("L-2"), i539A("L-2"), i765("L-2"), ds160("L-2"));

// ===================== O FAMILY =====================
add(i129Petition("O-1A"), i129OPSupplement("O-1A"), ds160("O-1A"), i539("O-1A"), i907("O-1A"));
add(i129Petition("O-1B"), i129OPSupplement("O-1B"), ds160("O-1B"), i539("O-1B"), i907("O-1B"));
add(i129Petition("O-2"), i129OPSupplement("O-2"), ds160("O-2"), i539("O-2"), i907("O-2"));
add(i539("O-3"), ds160("O-3"));

// ===================== P FAMILY =====================
add(i129Petition("P-1"), i129OPSupplement("P-1"), ds160("P-1"), i539("P-1"), i907("P-1"));
add(i129Petition("P-1S"), i129OPSupplement("P-1S"), ds160("P-1S"));
add(i129Petition("P-2"), i129OPSupplement("P-2"), ds160("P-2"), i539("P-2"), i907("P-2"));
add(i129Petition("P-2S"), i129OPSupplement("P-2S"), ds160("P-2S"));
add(i129Petition("P-3"), i129OPSupplement("P-3"), ds160("P-3"), i539("P-3"), i907("P-3"));
add(i129Petition("P-3S"), i129OPSupplement("P-3S"), ds160("P-3S"));
add(i539("P-4"), ds160("P-4"));

// ===================== Q =====================
add(i129Petition("Q-1"), i129QSupplement("Q-1"), ds160("Q-1"), i539("Q-1"), i907("Q-1"));

// ===================== R =====================
add(i129Petition("R-1"), i129RSupplement("R-1"), ds160("R-1"), i539("R-1"), i907("R-1"));
add(i539("R-2"), ds160("R-2"));

// ===================== E FAMILY =====================
add(
  ds160("E-1", { provisioningType: AUTO, initialCaseCreation: true }),
  m("E-1", "DS-156E", "Nonimmigrant Treaty Trader/Investor Application", "DOS", COND, ONLINE, { notes: "Applicable treaty trader/company employee workflow only." }),
  i129Petition("E-1", { provisioningType: COND, initialCaseCreation: false, notes: "USCIS COS/extension route only." }),
  i129ESupplement("E-1"),
  i907("E-1")
);
add(
  ds160("E-2", { provisioningType: AUTO, initialCaseCreation: true }),
  m("E-2", "DS-156E", "Nonimmigrant Treaty Trader/Investor Application", "DOS", COND, ONLINE),
  i129Petition("E-2", { provisioningType: COND, initialCaseCreation: false }),
  i129ESupplement("E-2"),
  i907("E-2")
);
add(
  m("E-3", "ETA-9035", "Labor Condition Application for Nonimmigrant Workers", "DOL", AUTO, ONLINE, { initialCaseCreation: true }),
  ds160("E-3", { provisioningType: AUTO, initialCaseCreation: true }),
  i129Petition("E-3", { provisioningType: COND, initialCaseCreation: false }),
  i129ESupplement("E-3"),
  i907("E-3")
);

// ===================== TN =====================
add(
  ds160("TN Canada"),
  i129Petition("TN Canada", { provisioningType: COND, initialCaseCreation: false, notes: "USCIS extension/change/status route only - TN Canada is typically adjudicated at the border, not via I-129." }),
  i539("TN Canada"),
  i907("TN Canada")
);
add(
  ds160("TN Mexico", { provisioningType: AUTO, initialCaseCreation: true }),
  i129Petition("TN Mexico", { provisioningType: COND, initialCaseCreation: false }),
  i539("TN Mexico"),
  i907("TN Mexico")
);

// ===================== K FAMILY =====================
add(
  m("K-1", "I-129F", "Petition for Alien Fiancé(e)", "USCIS", AUTO, STANDALONE, { formTemplateFormCode: "i-129f", initialCaseCreation: true, verificationSource: "uscis.gov/i-129f", verificationDate: new Date(), sourceVerified: true }),
  ds160("K-1", { provisioningType: AUTO, initialCaseCreation: true }),
  m("K-1", "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "post_marriage_aos", notes: "After marriage/AOS, not at initial case creation." }),
  i765("K-1", { provisioningType: COND }),
  i131("K-1", { provisioningType: COND })
);
add(
  m("K-3", "I-130", "Petition for Alien Relative", "USCIS", AUTO, STANDALONE, { formTemplateFormCode: "i-130", initialCaseCreation: true, immigrationNature: IMMIGRANT }),
  m("K-3", "I-130A", "Supplemental Information for Spouse Beneficiary", "USCIS", COND, SUPPLEMENT, { parentForm: "I-130", notes: "Spouse beneficiary only." }),
  m("K-3", "I-129F", "Petition for Alien Fiancé(e)", "USCIS", COND, STANDALONE, { notes: "K-3 pathway specific." }),
  ds160("K-3", { provisioningType: AUTO, initialCaseCreation: true }),
  m("K-3", "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "post_marriage_aos" }),
  i765("K-3", { provisioningType: COND }),
  i131("K-3", { provisioningType: COND })
);
add(m("K-2", "I-539", "Application to Extend/Change Nonimmigrant Status", "USCIS", COND, STANDALONE, { notes: "K-2 derivative status workflow." }));
add(m("K-4", "I-539", "Application to Extend/Change Nonimmigrant Status", "USCIS", COND, STANDALONE, { notes: "K-4 derivative status workflow." }));

// ===================== F FAMILY =====================
add(
  m("F-1", "I-20", "Certificate of Eligibility for Nonimmigrant Student Status", "SCHOOL_OR_PROGRAM_SPONSOR", REF, REFDOC, { initialCaseCreation: false, notes: "Student record issued by the school/SEVP, not a USCIS-generated CaseForm." }),
  ds160("F-1", { provisioningType: AUTO, initialCaseCreation: true }),
  i539("F-1"),
  i765("F-1", { notes: "OPT/EAD workflow." })
);
add(
  m("F-2", "I-20", "Certificate of Eligibility for Nonimmigrant Student Status", "SCHOOL_OR_PROGRAM_SPONSOR", REF, REFDOC, { initialCaseCreation: false }),
  ds160("F-2"),
  i539("F-2")
);

// ===================== J FAMILY =====================
add(
  m("J-1", "DS-2019", "Certificate of Eligibility for Exchange Visitor Status", "SCHOOL_OR_PROGRAM_SPONSOR", REF, REFDOC, { initialCaseCreation: false }),
  ds160("J-1", { provisioningType: AUTO, initialCaseCreation: true }),
  i539("J-1"),
  m("J-1", "DS-3035", "J Visa Waiver Recommendation Application", "DOS", COND, ONLINE, { notes: "Waiver workflow only." }),
  m("J-1", "I-612", "Application for Waiver of the Foreign Residence Requirement", "USCIS", COND, STANDALONE, { notes: "Waiver-related USCIS filing, only where applicable." })
);
add(
  m("J-2", "DS-2019", "Certificate of Eligibility for Exchange Visitor Status", "SCHOOL_OR_PROGRAM_SPONSOR", REF, REFDOC, { initialCaseCreation: false }),
  ds160("J-2"),
  i539("J-2"),
  i765("J-2")
);

// ===================== M FAMILY =====================
add(
  m("M-1", "I-20", "Certificate of Eligibility for Nonimmigrant Student Status", "SCHOOL_OR_PROGRAM_SPONSOR", REF, REFDOC, { initialCaseCreation: false }),
  ds160("M-1", { provisioningType: AUTO, initialCaseCreation: true }),
  i539("M-1"),
  i765("M-1", { notes: "Applicable employment authorization only." })
);
add(
  m("M-2", "I-20", "Certificate of Eligibility for Nonimmigrant Student Status", "SCHOOL_OR_PROGRAM_SPONSOR", REF, REFDOC, { initialCaseCreation: false }),
  ds160("M-2"),
  i539("M-2")
);

// ===================== VISITOR =====================
add(ds160("B-1", { provisioningType: AUTO, initialCaseCreation: true }), i539("B-1"));
add(ds160("B-2", { provisioningType: AUTO, initialCaseCreation: true }), i539("B-2"));
add(ds160("B-1/B-2", { provisioningType: AUTO, initialCaseCreation: true }), i539("B-1/B-2"));

// ===================== U VISA =====================
add(
  m("U-1", "I-918", "Petition for U Nonimmigrant Status", "USCIS", AUTO, STANDALONE, { initialCaseCreation: true, immigrationNature: "HUMANITARIAN", verificationSource: "uscis.gov/i-918", verificationDate: new Date(), sourceVerified: true }),
  m("U-1", "I-918 Supplement B", "U Nonimmigrant Status Certification", "USCIS", AUTO, SUPPLEMENT, { parentForm: "I-918", initialCaseCreation: true, immigrationNature: "HUMANITARIAN" }),
  i765("U-1", { immigrationNature: "HUMANITARIAN" }),
  m("U-1", "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", LATER, STANDALONE, { immigrationNature: "HUMANITARIAN", stage: "post_qualifying_u_period", notes: "Adjustment after qualifying U-status period." })
);
add(
  m("U derivative", "I-918 Supplement A", "Petition for Qualifying Family Member of U-1 Recipient", "USCIS", COND, SUPPLEMENT, { parentForm: "I-918", immigrationNature: "HUMANITARIAN", notes: "Qualifying family member only." }),
  i765("U derivative", { immigrationNature: "HUMANITARIAN" }),
  m("U derivative", "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", LATER, STANDALONE, { immigrationNature: "HUMANITARIAN", stage: "post_qualifying_u_period" })
);

// ===================== SB-1 =====================
add(
  m("SB-1", "DS-117", "Application to Determine Returning Resident Status", "DOS", AUTO, ONLINE, { initialCaseCreation: true, immigrationNature: IMMIGRANT }),
  m("SB-1", "DS-260", "Immigrant Visa Electronic Application", "DOS", LATER, ONLINE, { immigrationNature: IMMIGRANT, stage: "post_returning_resident_determination" }),
  m("SB-1", "I-551", "Permanent Resident Card", "USCIS", REF, REFDOC, { initialCaseCreation: false, immigrationNature: "PERMANENT_RESIDENT_DOCUMENT" }),
  m("SB-1", "I-131", "Application for Travel Documents, Parole Documents, and Arrival/Departure Records", "USCIS", REF, REFDOC, { initialCaseCreation: false, notes: "Prior re-entry permit, if applicable - reference only in this context." })
);

// ===================== OPT / STEM OPT =====================
add(
  i765("F-1 OPT", { provisioningType: AUTO, initialCaseCreation: true, notes: "The real USCIS EAD application." }),
  m("F-1 OPT", "I-20", "Certificate of Eligibility for Nonimmigrant Student Status", "SCHOOL_OR_PROGRAM_SPONSOR", REF, REFDOC, { initialCaseCreation: false })
);
add(
  i765("F-1 STEM OPT", { provisioningType: AUTO, initialCaseCreation: true, notes: "I-983 is NOT a replacement for I-765 - I-765 remains the USCIS EAD application." }),
  m("F-1 STEM OPT", "I-983", "Training Plan for STEM OPT Students", "SEVP", AUTO, GOVDOC, { initialCaseCreation: true, notes: "SEVP/DHS workflow document, distinct from and never substituting the I-765 EAD application." }),
  m("F-1 STEM OPT", "I-20", "Certificate of Eligibility for Nonimmigrant Student Status", "SCHOOL_OR_PROGRAM_SPONSOR", REF, REFDOC, { initialCaseCreation: false })
);

// ===================== EB-1 =====================
function eb1(visaType) {
  add(
    m(visaType, "I-140", "Immigrant Petition for Alien Worker", "USCIS", AUTO, STANDALONE, { formTemplateFormCode: "i-140", initialCaseCreation: true, immigrationNature: IMMIGRANT }),
    i485(visaType),
    ds260(visaType),
    i765(visaType, { immigrationNature: IMMIGRANT, processingPaths: ["ADJUSTMENT_OF_STATUS"], notes: "AOS EAD." }),
    i131(visaType, { immigrationNature: IMMIGRANT, processingPaths: ["ADJUSTMENT_OF_STATUS"], notes: "AOS travel document." }),
    i693(visaType),
    i907(visaType, { immigrationNature: IMMIGRANT })
  );
}
eb1("EB-1A"); eb1("EB-1B"); eb1("EB-1C");

// ===================== EB-2 =====================
add(
  m("EB-2 PERM", "ETA-9141", "Application for Prevailing Wage Determination", "DOL", LATER, ONLINE, { immigrationNature: IMMIGRANT, stage: "perm" }),
  m("EB-2 PERM", "ETA-9089", "Application for Permanent Employment Certification", "DOL", LATER, ONLINE, { immigrationNature: IMMIGRANT, stage: "perm" }),
  m("EB-2 PERM", "I-140", "Immigrant Petition for Alien Worker", "USCIS", LATER, STANDALONE, { formTemplateFormCode: "i-140", immigrationNature: IMMIGRANT, stage: "post_perm" }),
  m("EB-2 PERM", "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status", processingPaths: ["ADJUSTMENT_OF_STATUS"] }),
  m("EB-2 PERM", "DS-260", "Immigrant Visa Electronic Application", "DOS", LATER, ONLINE, { immigrationNature: IMMIGRANT, stage: "immigrant_visa", processingPaths: ["CONSULAR", "NVC"] }),
  m("EB-2 PERM", "I-765", "Application for Employment Authorization", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status" }),
  m("EB-2 PERM", "I-131", "Application for Travel Documents, Parole Documents, and Arrival/Departure Records", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status" }),
  m("EB-2 PERM", "I-693", "Report of Immigration Medical Examination and Vaccination Record", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status" }),
  i907("EB-2 PERM", { immigrationNature: IMMIGRANT })
);
add(
  m("EB-2 NIW", "I-140", "Immigrant Petition for Alien Worker", "USCIS", AUTO, STANDALONE, { formTemplateFormCode: "i-140", initialCaseCreation: true, immigrationNature: IMMIGRANT, notes: "No PERM labor certification required for NIW." }),
  i485("EB-2 NIW"),
  ds260("EB-2 NIW"),
  i765("EB-2 NIW", { immigrationNature: IMMIGRANT, processingPaths: ["ADJUSTMENT_OF_STATUS"] }),
  i131("EB-2 NIW", { immigrationNature: IMMIGRANT, processingPaths: ["ADJUSTMENT_OF_STATUS"] }),
  i693("EB-2 NIW"),
  i907("EB-2 NIW", { immigrationNature: IMMIGRANT })
);

// ===================== EB-3 =====================
function eb3Perm(visaType) {
  add(
    m(visaType, "ETA-9141", "Application for Prevailing Wage Determination", "DOL", LATER, ONLINE, { immigrationNature: IMMIGRANT, stage: "perm" }),
    m(visaType, "ETA-9089", "Application for Permanent Employment Certification", "DOL", LATER, ONLINE, { immigrationNature: IMMIGRANT, stage: "perm" }),
    m(visaType, "I-140", "Immigrant Petition for Alien Worker", "USCIS", LATER, STANDALONE, { formTemplateFormCode: "i-140", immigrationNature: IMMIGRANT, stage: "post_perm" }),
    m(visaType, "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status", processingPaths: ["ADJUSTMENT_OF_STATUS"] }),
    m(visaType, "DS-260", "Immigrant Visa Electronic Application", "DOS", LATER, ONLINE, { immigrationNature: IMMIGRANT, stage: "immigrant_visa", processingPaths: ["CONSULAR", "NVC"] }),
    m(visaType, "I-765", "Application for Employment Authorization", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status" }),
    m(visaType, "I-131", "Application for Travel Documents, Parole Documents, and Arrival/Departure Records", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status" }),
    m(visaType, "I-693", "Report of Immigration Medical Examination and Vaccination Record", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status" }),
    i907(visaType, { immigrationNature: IMMIGRANT })
  );
}
eb3Perm("EB-3 Skilled Worker"); eb3Perm("EB-3 Professional"); eb3Perm("EB-3 Other Worker");

// ===================== EB-4 =====================
add(
  m("EB-4", "I-360", "Petition for Amerasian, Widow(er), or Special Immigrant", "USCIS", AUTO, STANDALONE, { initialCaseCreation: true, immigrationNature: IMMIGRANT }),
  i485("EB-4"), ds260("EB-4"),
  i765("EB-4", { immigrationNature: IMMIGRANT, processingPaths: ["ADJUSTMENT_OF_STATUS"] }),
  i131("EB-4", { immigrationNature: IMMIGRANT, processingPaths: ["ADJUSTMENT_OF_STATUS"] }),
  i693("EB-4")
);

// ===================== EB-5 =====================
add(
  m("EB-5 Regional Center", "I-526E", "Immigrant Petition by Regional Center Investor", "USCIS", AUTO, STANDALONE, { initialCaseCreation: true, immigrationNature: IMMIGRANT, verificationSource: "uscis.gov/i-526e", verificationDate: new Date(), sourceVerified: true, notes: "Regional Center path - never substitute I-526 (Standalone) for this." }),
  m("EB-5 Regional Center", "I-956F", "Application for Approval of an Investment in a Commercial Enterprise", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "project_level_filing", notes: "Project-level filing, only when applicable." }),
  m("EB-5 Regional Center", "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status" }),
  m("EB-5 Regional Center", "DS-260", "Immigrant Visa Electronic Application", "DOS", LATER, ONLINE, { immigrationNature: IMMIGRANT, stage: "immigrant_visa" }),
  m("EB-5 Regional Center", "I-765", "Application for Employment Authorization", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT }),
  m("EB-5 Regional Center", "I-131", "Application for Travel Documents, Parole Documents, and Arrival/Departure Records", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT }),
  m("EB-5 Regional Center", "I-693", "Report of Immigration Medical Examination and Vaccination Record", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT }),
  m("EB-5 Regional Center", "I-829", "Petition by Investor to Remove Conditions on Permanent Resident Status", "USCIS", LATER, STANDALONE, { immigrationNature: "CONDITIONAL_PERMANENT_RESIDENT", stage: "condition_removal" })
);
add(
  m("EB-5 Standalone", "I-526", "Immigrant Petition by Standalone Investor", "USCIS", AUTO, STANDALONE, { initialCaseCreation: true, immigrationNature: IMMIGRANT, verificationSource: "uscis.gov/i-526", verificationDate: new Date(), sourceVerified: true, notes: "Standalone path - never substitute I-526E (Regional Center) for this." }),
  m("EB-5 Standalone", "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", LATER, STANDALONE, { immigrationNature: IMMIGRANT, stage: "adjustment_of_status" }),
  m("EB-5 Standalone", "DS-260", "Immigrant Visa Electronic Application", "DOS", LATER, ONLINE, { immigrationNature: IMMIGRANT, stage: "immigrant_visa" }),
  m("EB-5 Standalone", "I-765", "Application for Employment Authorization", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT }),
  m("EB-5 Standalone", "I-131", "Application for Travel Documents, Parole Documents, and Arrival/Departure Records", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT }),
  m("EB-5 Standalone", "I-693", "Report of Immigration Medical Examination and Vaccination Record", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT }),
  m("EB-5 Standalone", "I-829", "Petition by Investor to Remove Conditions on Permanent Resident Status", "USCIS", LATER, STANDALONE, { immigrationNature: "CONDITIONAL_PERMANENT_RESIDENT", stage: "condition_removal" })
);

// ===================== FAMILY-BASED (IR/CR/F categories) =====================
function familyBased(visaType, opts = {}) {
  add(
    m(visaType, "I-130", "Petition for Alien Relative", "USCIS", AUTO, STANDALONE, { formTemplateFormCode: "i-130", initialCaseCreation: true, immigrationNature: IMMIGRANT }),
    m(visaType, "I-130A", "Supplemental Information for Spouse Beneficiary", "USCIS", COND, SUPPLEMENT, { parentForm: "I-130", immigrationNature: IMMIGRANT, notes: "Spouse-beneficiary trigger.", triggerCondition: opts.spouseTrigger || null }),
    m(visaType, "I-864", "Affidavit of Support Under Section 213A of the INA", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT, notes: "Immigrant case requires Affidavit of Support." }),
    m(visaType, "I-864A", "Contract Between Sponsor and Household Member", "USCIS", COND, SUPPLEMENT, { parentForm: "I-864", immigrationNature: IMMIGRANT, notes: "Qualifying household member contributes income." }),
    m(visaType, "I-864EZ", "Affidavit of Support Under Section 213A of the INA (EZ)", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT, notes: "Sponsor meets I-864EZ criteria." }),
    i485(visaType),
    ds260(visaType),
    i765(visaType, { immigrationNature: IMMIGRANT, processingPaths: ["ADJUSTMENT_OF_STATUS"] }),
    i131(visaType, { immigrationNature: IMMIGRANT, processingPaths: ["ADJUSTMENT_OF_STATUS"] }),
    i693(visaType)
  );
}
["IR-1", "CR-1", "IR-2", "CR-2", "IR-3", "IR-4", "IR-5", "F1", "F2A", "F2B", "F3", "F4"].forEach((v) => familyBased(v, v === "IR-1" || v === "CR-1" ? { spouseTrigger: { field: "caseType", operator: "equals", value: "immigration" } } : {}));

// ===================== GC-NVC (consular immigrant workflow) =====================
add(
  ds260("GC-NVC", { provisioningType: AUTO, initialCaseCreation: true, processingPaths: [], notes: "AUTO_CREATE when a case enters immigrant consular processing." }),
  m("GC-NVC", "DS-261", "Choice of Address and Agent", "DOS", COND, ONLINE, { immigrationNature: IMMIGRANT, notes: "NVC workflow/applicability dependent." }),
  m("GC-NVC", "I-864", "Affidavit of Support Under Section 213A of the INA", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT }),
  m("GC-NVC", "I-864A", "Contract Between Sponsor and Household Member", "USCIS", COND, SUPPLEMENT, { parentForm: "I-864", immigrationNature: IMMIGRANT }),
  m("GC-NVC", "I-864EZ", "Affidavit of Support Under Section 213A of the INA (EZ)", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT })
);

// ===================== GREEN CARD WORKFLOWS =====================
add(
  m("Adjustment of Status", "I-485", "Application to Register Permanent Residence or Adjust Status", "USCIS", AUTO, STANDALONE, { formTemplateFormCode: "i-485", initialCaseCreation: true, immigrationNature: IMMIGRANT, notes: "AUTO_CREATE only when the case is explicitly created as an AOS workflow." }),
  i765("Adjustment of Status", { immigrationNature: IMMIGRANT }),
  i131("Adjustment of Status", { immigrationNature: IMMIGRANT }),
  i693("Adjustment of Status", { processingPaths: [] }),
  m("Adjustment of Status", "I-864", "Affidavit of Support Under Section 213A of the INA", "USCIS", COND, STANDALONE, { immigrationNature: IMMIGRANT })
);
add(m("Conditional Green Card Removal", "I-751", "Petition to Remove Conditions on Residence", "USCIS", AUTO, STANDALONE, { initialCaseCreation: true, immigrationNature: "CONDITIONAL_PERMANENT_RESIDENT", verificationSource: "uscis.gov/i-751", verificationDate: new Date(), sourceVerified: true, notes: "Must never also auto-create I-90." }));
add(m("Green Card Renewal", "I-90", "Application to Replace Permanent Resident Card", "USCIS", AUTO, STANDALONE, { initialCaseCreation: true, immigrationNature: "PERMANENT_RESIDENT_DOCUMENT", verificationSource: "uscis.gov/i-90", verificationDate: new Date(), sourceVerified: true, notes: "Must never also auto-create I-751." }));
add(m("Re-entry Permit", "I-131", "Application for Travel Documents, Parole Documents, and Arrival/Departure Records", "USCIS", AUTO, STANDALONE, { formTemplateFormCode: "i-131", initialCaseCreation: true, immigrationNature: "TRAVEL_DOCUMENT", notes: "I-131 is a travel-document application, not a visa classification itself." }));

// ===================== CITIZENSHIP =====================
add(m("Naturalization", "N-400", "Application for Naturalization", "USCIS", AUTO, STANDALONE, { initialCaseCreation: true, immigrationNature: "CITIZENSHIP", verificationSource: "uscis.gov/n-400", verificationDate: new Date(), sourceVerified: true, notes: "Must never also auto-create N-600." }));
add(m("Certificate of Citizenship", "N-600", "Application for Certificate of Citizenship", "USCIS", AUTO, STANDALONE, { initialCaseCreation: true, immigrationNature: "CITIZENSHIP", verificationSource: "uscis.gov/n-600", verificationDate: new Date(), sourceVerified: true, notes: "Must never also auto-create N-400." }));
add(m("Replacement Citizenship Certificate", "N-565", "Application for Replacement Naturalization/Citizenship Document", "USCIS", AUTO, STANDALONE, { initialCaseCreation: true, immigrationNature: "CITIZENSHIP" }));

// ===================== I-824 (post-approval, common cross-visa) =====================
// Not tied to a single visaType - the spec explicitly requires this to
// never auto-fire from any petition approval. Registered under a
// dedicated pseudo-category rather than duplicated per visa.
add(m("Action on Approved Case", "I-824", "Application for Action on an Approved Application or Petition", "USCIS", COND, STANDALONE, { immigrationNature: "POST_APPROVAL", notes: "Case must be eligible for post-approval action AND the case manager must explicitly select \"Action on Approved Case\" - never auto-created merely because another petition was approved. No generic trigger field exists for this in the current whitelist; CM-initiated only." }));

module.exports = { mappings };
