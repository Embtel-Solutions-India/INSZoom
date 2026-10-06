// Extends the EXISTING VisaFormMapping registry with checklist/questionnaire
// associations (VisaFormMapping.checklistMappings, added in
// Backend/src/models/VisaFormMapping.js) - transcribed from the approved
// checklist-mapping business spec. This is data, not a second registry: it
// only $set's checklistMappings on rows that already exist (created by
// visaFormMappings.seed.js), by exact {visaType, formNumber}. A
// (visaType, formNumber) pair with no entry below is a deliberate GAP
// (no authored checklist for that combination yet) - never silently
// defaulted to another visa's checklist.
//
// Scope notes (visaTypes the spec is silent on are left untouched, not
// guessed at): H-1B1 Chile/Singapore, H-2A/H-2B/H-3, Q-1, R-1/R-2, J-1/J-2,
// M-1/M-2, U-1/U derivative, Re-entry Permit, EB-1C, EB-4, "GC-NVC" (a
// separate pre-existing visaType row, distinct from the per-family-type
// gc_nvc_<type>_beneficiary_checklist keys below) are not touched by this
// seed - they report as GAP by having an empty checklistMappings array,
// exactly as intended.
//
// Family AOS/Consular processing paths share ONE VisaFormMapping document
// per (visaType, formNumber) - VisaFormMapping's own unique index
// ({visaType, formNumber, componentType}) allows no other shape. Where the
// spec's Petition-Only/AOS/Consular subsections describe the same form
// consistently (I-864 AUTO in both AOS and Consular; I-130 AUTO in all
// three), one checklistMappings entry covers every path; nothing here
// needs a per-path branch.
const VisaFormMapping = require("../../../models/VisaFormMapping");

const AUTO = "AUTO";
const COND = "CONDITIONAL";
const EXPLICIT_CM = "EXPLICIT_CM";

function cm(checklistKey, assignmentType, opts = {}) {
  return { checklistKey, assignmentType, role: opts.role || "", condition: opts.condition || null, notes: opts.notes || "" };
}

const NEW_OFFICE_CONDITION = { field: "newOfficePetition", operator: "equals", value: true };
const JOINT_SPONSOR_CONDITION = { field: "hasJointSponsor", operator: "equals", value: true };

// { visaType, formNumber, checklistMappings }[]
const ENTRIES = [];
function set(visaType, formNumber, checklistMappings) {
  ENTRIES.push({ visaType, formNumber, checklistMappings });
}

// ---- H-1B (spec §3 H-1B) ---------------------------------------------
set("H-1B", "I-129", [cm("h1b_employer_checklist", AUTO, { role: "employer" }), cm("h1b_employee_checklist", AUTO, { role: "employee" })]);
set("H-1B", "I-539", [cm("h1b_employee_checklist", COND, { role: "employee", notes: "COS / extension workflow" })]);
set("H-1B", "I-907", [cm("h1b_employer_checklist", COND, { role: "employer" }), cm("h1b_employee_checklist", COND, { role: "employee" })]);
// G-28 -> no client checklist (spec is explicit about this - no entry).

// ---- L-1A (spec §3 L-1A) ----------------------------------------------
set("L-1A", "I-129", [cm("l1a_employer_checklist", AUTO, { role: "employer" }), cm("l1a_employee_checklist", AUTO, { role: "employee" })]);
set("L-1A", "I-129S", [cm("l1a_employer_checklist", COND, { role: "employer", notes: "blanket petition workflow" }), cm("l1a_employee_checklist", COND, { role: "employee", notes: "blanket petition workflow" })]);
set("L-1A", "I-539", [cm("l1a_employee_checklist", COND, { role: "employee", notes: "COS / extension" })]);
set("L-1A", "I-907", [cm("l1a_employer_checklist", COND, { role: "employer" }), cm("l1a_employee_checklist", COND, { role: "employee" })]);
// Business plan checklist rides on I-129 too, gated on New Office - added
// as a SECOND entry on the same I-129 row (merged with the two above).
{
  const existing = ENTRIES.find((e) => e.visaType === "L-1A" && e.formNumber === "I-129");
  existing.checklistMappings.push(cm("l1a_business_plan_checklist", COND, { role: "employer", condition: NEW_OFFICE_CONDITION, notes: "New Office petition only - never every L-1A case" }));
}

// L-1B: its own copy of every L-1A checklist (l1b_*), mapped to the same
// forms as L-1A (I-129 + business plan on New Office, I-129S, I-539, I-907).
set("L-1B", "I-129", [cm("l1b_employer_checklist", AUTO, { role: "employer" }), cm("l1b_employee_checklist", AUTO, { role: "employee" }), cm("l1b_business_plan_checklist", COND, { role: "employer", condition: NEW_OFFICE_CONDITION, notes: "New Office petition only" })]);
set("L-1B", "I-129S", [cm("l1b_employer_checklist", COND, { role: "employer", notes: "blanket petition workflow" }), cm("l1b_employee_checklist", COND, { role: "employee", notes: "blanket petition workflow" })]);
set("L-1B", "I-539", [cm("l1b_employee_checklist", COND, { role: "employee", notes: "COS / extension" })]);
set("L-1B", "I-907", [cm("l1b_employer_checklist", COND, { role: "employer" }), cm("l1b_employee_checklist", COND, { role: "employee" })]);

// ---- E-2 (spec §3 E-2) -------------------------------------------------
set("E-2", "I-129", [cm("e2_visa_checklist", COND, { notes: "USCIS COS/extension route" })]);
set("E-2", "I-907", [cm("e2_visa_checklist", COND)]);

// ---- E-3 (spec §3 E-3) -------------------------------------------------
set("E-3", "I-129", [cm("e3_employer_checklist", COND, { role: "employer" }), cm("e3_employee_checklist", COND, { role: "employee" })]);
set("E-3", "I-907", [cm("e3_employer_checklist", COND, { role: "employer" }), cm("e3_employee_checklist", COND, { role: "employee" })]);

// ---- P-1 / P-2 / P-3 (spec §3 "P-1A/P-1B/P-3", shared p_* checklists) --
// DB's real P visaTypes are numeric (P-1/P-2/P-3), not lettered (P-1A/
// P-1B) - applied to all three real P classifications the spec's intent
// covers, explicitly NOT to P-1S/P-2S/P-3S (spec's own instruction).
for (const visaType of ["P-1", "P-2", "P-3"]) {
  set(visaType, "I-129", [cm("p_employer_checklist", AUTO, { role: "employer" }), cm("p_employee_checklist", AUTO, { role: "employee" })]);
  set(visaType, "I-539", [cm("p_employee_checklist", COND, { role: "employee", notes: "COS / extension" })]);
  set(visaType, "I-907", [cm("p_employer_checklist", COND, { role: "employer" }), cm("p_employee_checklist", COND, { role: "employee" })]);
}

// ---- O-1A / O-1B (spec §3 O-1A/O-1B) -----------------------------------
for (const visaType of ["O-1A", "O-1B"]) {
  set(visaType, "I-129", [cm("o1_employer_checklist", AUTO, { role: "employer" }), cm("o1_employee_checklist", AUTO, { role: "employee" })]);
  set(visaType, "I-539", [cm("o1_employee_checklist", COND, { role: "employee" })]);
  set(visaType, "I-907", [cm("o1_employer_checklist", COND, { role: "employer" }), cm("o1_employee_checklist", COND, { role: "employee" })]);
}
// O-2 (support staff for an O-1 alien): filed on the same I-129 O/P
// supplement with the same employer/employee structure, so it shares the O-1
// O-2 checklists (o2_*): its own employer/employee content, see o2.js.
set("O-2", "I-129", [cm("o2_employer_checklist", AUTO, { role: "employer" }), cm("o2_employee_checklist", AUTO, { role: "employee" })]);
set("O-2", "I-539", [cm("o2_employee_checklist", COND, { role: "employee" })]);
set("O-2", "I-907", [cm("o2_employer_checklist", COND, { role: "employer" }), cm("o2_employee_checklist", COND, { role: "employee" })]);

// ---- EB-1A (spec §3 EB-1A, uses eb1a_questionnaire) --------------------
set("EB-1A", "I-140", [cm("eb1a_questionnaire", AUTO)]);
for (const formNumber of ["I-485", "I-765", "I-131", "I-693", "I-907"]) {
  set("EB-1A", formNumber, [cm("eb1a_questionnaire", COND, { notes: "AOS workflow" })]);
}

// ---- EB-1B (spec §3 EB-1B) ----------------------------------------------
set("EB-1B", "I-140", [cm("eb1b_employer_checklist", AUTO, { role: "employer" }), cm("eb1b_employee_checklist", AUTO, { role: "employee" })]);
for (const formNumber of ["I-485", "I-765", "I-131", "I-693"]) {
  set("EB-1B", formNumber, [cm("eb1b_employee_checklist", COND, { role: "employee" })]);
}
set("EB-1B", "I-907", [cm("eb1b_employer_checklist", COND, { role: "employer" }), cm("eb1b_employee_checklist", COND, { role: "employee" })]);

// ---- EB-2 / EB-2 PERM (spec §3 EB-2, i140_* checklists) -----------------
for (const visaType of ["EB-2", "EB-2 PERM"]) {
  set(visaType, "I-140", [cm("i140_petitioner_checklist", AUTO, { role: "petitioner" }), cm("i140_beneficiary_checklist", AUTO, { role: "beneficiary" })]);
  for (const formNumber of ["I-485", "I-765", "I-131", "I-693"]) {
    set(visaType, formNumber, [cm("i140_beneficiary_checklist", COND, { role: "beneficiary" })]);
  }
  set(visaType, "I-907", [cm("i140_petitioner_checklist", COND, { role: "petitioner" }), cm("i140_beneficiary_checklist", COND, { role: "beneficiary" })]);
}
// EB-2 NIW (spec §3 "EB-2 NIW: use niw_questionnaire, not the generic
// i140_* checklists, and never for every EB-2 case") - mirrors EB-1A's own
// single-questionnaire-across-the-AOS-stage-forms shape.
set("EB-2 NIW", "I-140", [cm("niw_questionnaire", AUTO)]);
for (const formNumber of ["I-485", "I-765", "I-131", "I-693", "I-907"]) {
  set("EB-2 NIW", formNumber, [cm("niw_questionnaire", COND, { notes: "AOS workflow" })]);
}

// ---- EB-3 (spec §3 EB-3, all classifications share i140_*) -------------
for (const visaType of ["EB-3", "EB-3 Professional", "EB-3 Skilled Worker", "EB-3 Other Worker"]) {
  set(visaType, "I-140", [cm("i140_petitioner_checklist", AUTO, { role: "petitioner" }), cm("i140_beneficiary_checklist", AUTO, { role: "beneficiary" })]);
  for (const formNumber of ["I-485", "I-765", "I-131", "I-693"]) {
    set(visaType, formNumber, [cm("i140_beneficiary_checklist", COND, { role: "beneficiary" })]);
  }
  set(visaType, "I-907", [cm("i140_petitioner_checklist", COND, { role: "petitioner" }), cm("i140_beneficiary_checklist", COND, { role: "beneficiary" })]);
}

// ---- TN (spec §3 TN) ----------------------------------------------------
for (const visaType of ["TN Canada", "TN Mexico"]) {
  set(visaType, "I-129", [cm("tn_employer_checklist", COND, { role: "employer" }), cm("tn_employee_checklist", COND, { role: "employee" })]);
  set(visaType, "I-539", [cm("tn_employee_checklist", COND, { role: "employee" })]);
  set(visaType, "I-907", [cm("tn_employer_checklist", COND, { role: "employer" }), cm("tn_employee_checklist", COND, { role: "employee" })]);
}

// ---- H-4 (spec §4) - real DB visaTypes are H4EXTENSION/H4EAD/H4EXTENSIONEAD
set("H4EXTENSION", "I-539", [cm("h4_extension_questionnaire", AUTO)]);
set("H4EXTENSION", "I-539A", [cm("h4_extension_questionnaire", COND)]);
set("H4EAD", "I-765", [cm("h4_ead_questionnaire", AUTO)]);
set("H4EXTENSIONEAD", "I-539", [cm("h4_extension_ead_questionnaire", AUTO)]);
set("H4EXTENSIONEAD", "I-539A", [cm("h4_extension_ead_questionnaire", COND)]);
set("H4EXTENSIONEAD", "I-765", [cm("h4_extension_ead_questionnaire", AUTO)]);

// ---- Change of Status (spec §5) - real DB visaTypes COSF1/COSF2/COSB1/COSB2
set("COSF1", "I-539", [cm("cos_f1_questionnaire", AUTO)]);
set("COSF1", "I-539A", [cm("cos_f1_questionnaire", COND)]);
set("COSF1", "I-907", [cm("cos_f1_questionnaire", COND)]);
set("COSF2", "I-539", [cm("cos_f2_questionnaire", AUTO)]);
set("COSF2", "I-539A", [cm("cos_f2_questionnaire", COND)]);
set("COSB1", "I-539", [cm("cos_b1_questionnaire", AUTO)]);
// COS -> B-2 and F-1 -> B-2 share the same destination-driven checklist -
// both real DB visaTypes get the identical entry, never a second checklist.
set("COSB2", "I-539", [cm("cos_b2_questionnaire", AUTO)]);
set("B-1/B-2", "I-539", [cm("cos_b2_questionnaire", AUTO)]);

// ---- Family-based (spec §6) --------------------------------------------
const FAMILY_VISA_TYPES = ["IR-1", "CR-1", "IR-2", "CR-2", "IR-3", "IR-4", "IR-5", "F1", "F2A", "F2B", "F3", "F4"];
function familySlug(visaType) {
  return visaType.toLowerCase().replace(/[^a-z0-9]/g, "");
}
for (const visaType of FAMILY_VISA_TYPES) {
  const slug = familySlug(visaType);
  // Petition Only + AOS + Consular all share these same rows/entries per
  // spec (see file banner) - one set of checklistMappings covers all three.
  set(visaType, "I-130", [
    cm(`i130_${slug}_petitioner_checklist`, AUTO, { role: "petitioner" }),
    cm(`i130_${slug}_beneficiary_checklist`, AUTO, { role: "beneficiary" }),
  ]);
  set(visaType, "I-485", [cm(`green_card_${slug}_beneficiary_checklist`, AUTO, { role: "beneficiary" })]);
  set(visaType, "I-765", [cm(`green_card_${slug}_beneficiary_checklist`, COND, { role: "beneficiary" })]);
  set(visaType, "I-131", [cm(`green_card_${slug}_beneficiary_checklist`, COND, { role: "beneficiary" })]);
  set(visaType, "I-693", [cm(`green_card_${slug}_beneficiary_checklist`, COND, { role: "beneficiary" })]);
  set(visaType, "I-864", [
    cm(`i864_${slug}_petitioner_checklist`, AUTO, { role: "petitioner" }),
    // Joint sponsor: CONDITIONAL, only active once a joint sponsor is
    // actually added/approved for the case - never a default checklist.
    cm(`i864_${slug}_joint_sponsor_checklist`, COND, { role: "joint_sponsor", condition: JOINT_SPONSOR_CONDITION }),
    // NVC checklist: EXPLICIT_CM per spec - never auto-assigned solely
    // because the processing path is CONSULAR.
    cm(`gc_nvc_${slug}_beneficiary_checklist`, EXPLICIT_CM, { role: "beneficiary" }),
  ]);
}

// ---- K-1 (spec §7) -------------------------------------------------------
set("K-1", "I-129F", [cm("k1_petitioner_checklist", AUTO, { role: "petitioner" }), cm("k1_beneficiary_checklist", AUTO, { role: "beneficiary" })]);
// I-134 (Declaration of Financial Support) has no dedicated K-1 checklist -
// its sponsor identity/employment fields are already collected by
// k1_petitioner_checklist (see familyChecklists.js/family-workflow/
// questionnaires/k1.js), so it is reused here rather than inventing a new
// checklist (Phase 3A decision). Any I-134 fields that checklist does not
// cover (e.g. income/household size figures) are a legitimate missing-data
// gap, not a mis-mapping - never fabricated just to raise coverage.
set("K-1", "I-134", [cm("k1_petitioner_checklist", COND, { role: "petitioner" })]);
set("K-1", "I-485", [cm("k1_beneficiary_checklist", COND, { role: "beneficiary" })]);
set("K-1", "I-765", [cm("k1_beneficiary_checklist", COND, { role: "beneficiary" })]);
set("K-1", "I-131", [cm("k1_beneficiary_checklist", COND, { role: "beneficiary" })]);
// DS-160 deliberately excluded (DOS form).

// ---- K-3 (spec §8) -------------------------------------------------------
set("K-3", "I-130", [cm("k3_petitioner_checklist", AUTO, { role: "petitioner" }), cm("k3_beneficiary_checklist", AUTO, { role: "beneficiary" })]);
set("K-3", "I-129F", [cm("k3_petitioner_checklist", COND, { role: "petitioner" }), cm("k3_beneficiary_checklist", COND, { role: "beneficiary" })]);
// I-134 reuses k3_petitioner_checklist for the same reason as K-1 above -
// no dedicated affidavit-of-support checklist exists for K-3, and the
// petitioner checklist already covers sponsor identity/employment.
set("K-3", "I-134", [cm("k3_petitioner_checklist", COND, { role: "petitioner" })]);
set("K-3", "I-485", [cm("k3_beneficiary_checklist", COND, { role: "beneficiary" })]);
set("K-3", "I-765", [cm("k3_beneficiary_checklist", COND, { role: "beneficiary" })]);
set("K-3", "I-131", [cm("k3_beneficiary_checklist", COND, { role: "beneficiary" })]);
// I-130A intentionally not mapped as its own standalone checklist/form
// relationship (it's a SUPPLEMENT of I-130, per the registry's own rules).

// ---- Green Card Renewal (spec §9) ---------------------------------------
set("Green Card Renewal", "I-90", [cm("green_card_renewal_checklist", AUTO)]);

// ---- Premium Processing (Form I-907) ------------------------------------
// One dedicated checklist (premiumProcessingChecklist.js). On the standalone "Premium
// Processing" case it is the case's AUTO checklist. For every other visa type's I-907
// row (a Case-Manager-decision CONDITIONAL form) it is APPENDED to whatever the spec
// already lists there - the Case Manager's "Upgrade to Premium Processing" button
// assigns it, and the I-907 mapping graph reads its answers.
const I907_CHECKLIST = "i907_premium_processing_profile";
set("Premium Processing", "I-907", [cm(I907_CHECKLIST, AUTO)]);
for (const entry of ENTRIES) {
  if (entry.formNumber !== "I-907" || entry.visaType === "Premium Processing") continue;
  entry.checklistMappings.push(cm(I907_CHECKLIST, EXPLICIT_CM, { notes: "Premium Processing upgrade checklist - never auto-assigned; added by the Case Manager upgrade button" }));
}

// ---- I-131 standalone/add-on (spec §10) ---------------------------------
// EXPLICIT_CM everywhere it's a genuinely optional add-on (not already
// covered by a visa-specific AUTO/CONDITIONAL entry above, e.g. EB-1A/
// EB-1B/EB-2/EB-3/family/K-1/K-3 already attach their OWN checklist to
// I-131 above - this generic i131_checklist entry is for every OTHER
// visaType whose I-131 is genuinely a standalone travel-document add-on
// with no visa-specific checklist of its own, e.g. "Re-entry Permit" and
// "Adjustment of Status" (a generic/unclassified AOS bucket, distinct from
// the specific EB-*/family rows above).
for (const visaType of ["Re-entry Permit", "Adjustment of Status"]) {
  set(visaType, "I-131", [cm("i131_checklist", EXPLICIT_CM, { notes: "conditional form decision - never auto-assigned to every case" })]);
}

// ---- N-400 / N-565 / N-600 (spec §11-13) --------------------------------
// Real registry visaType strings (confirmed live) are the case-purpose
// labels, not the form numbers themselves. N-565 is cross-listed under all
// three - the same replacement-certificate checklist applies regardless of
// which underlying document is being replaced.
set("Naturalization", "N-400", [cm("n400_checklist", AUTO)]);
set("Certificate of Citizenship", "N-600", [cm("n600_checklist", AUTO)]);
set("Replacement Citizenship Certificate", "N-565", [cm("n565_checklist", AUTO)]);
set("Naturalization", "N-565", [cm("n565_checklist", AUTO)]);
set("Certificate of Citizenship", "N-565", [cm("n565_checklist", AUTO)]);

// ---- SB-1 (spec §14) ------------------------------------------------------
// DS-117 is a Department of State form (confirmed: agency "DOS") - §1's
// USCIS-only rule wins over "keep this as the SB-1 workflow checklist":
// sb1_returning_resident_document_checklist stays assigned the way it
// already is (isDefault:true, visaType:"SB-1", auto-resolved generically
// by the existing questionnaire system) rather than via a DOS-form
// VisaFormMapping row, which §1 explicitly forbids. No entry here.

// Sections 15/16/17 (scaffold-only filing types, EB-5 GAP, legacy
// standalone questionnaires) are deliberately NOT touched here:
// - cos_generic_questionnaire / f1_reinstatement_questionnaire /
//   ead_i765_questionnaire stay scaffold-only (§15) - no VisaFormMapping
//   row gets them attached by this seed.
// - EB-5 Regional Center / EB-5 Standalone stay GAP (§16) - explicitly not
//   reusing e2_visa_checklist/e2_business_plan_checklist.
// - o1a_questionnaire/eb1a_questionnaire/niw_questionnaire/h1b_questionnaire
//   (§17) already reused above only where the spec calls for them
//   (eb1a_questionnaire, niw_questionnaire) - o1a_questionnaire and
//   h1b_questionnaire are NOT reused here since O-1A/O-1B and H-1B already
//   have their own newer o1_*/h1b_* checklists per §3, and the spec is
//   explicit that a newer dedicated checklist must not be silently
//   replaced by the legacy questionnaire.

async function seedChecklistMappings() {
  const results = { updated: 0, notFound: [] };
  for (const entry of ENTRIES) {
    const res = await VisaFormMapping.updateOne(
      { visaType: entry.visaType, formNumber: entry.formNumber },
      { $set: { checklistMappings: entry.checklistMappings } }
    );
    if (res.matchedCount === 0) results.notFound.push(`${entry.visaType} / ${entry.formNumber}`);
    else results.updated += 1;
  }
  return results;
}

module.exports = seedChecklistMappings;
module.exports.ENTRIES = ENTRIES;
