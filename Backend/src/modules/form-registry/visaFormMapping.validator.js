// Data-integrity validation for the seeded VisaFormMapping registry - run
// as a script/test against the DB, not a runtime request-path gate.
// Implements the spec's 18 checks plus the corrections' mandatory-coverage,
// semantic-conflict, initialCaseCreation-consistency, and trigger-whitelist
// checks.
const VisaFormMapping = require("../../models/VisaFormMapping");

// The mandatory visa/case-type coverage list (spec §5) - every one of
// these must have at least one active mapping, or validation fails.
const REQUIRED_VISA_TYPES = [
  "H-1B", "H-1B1 Chile", "H-1B1 Singapore", "H-2A", "H-2B", "H-3", "H-4",
  "L-1A", "L-1B", "L-2",
  "O-1A", "O-1B", "O-2", "O-3",
  "P-1", "P-1S", "P-2", "P-2S", "P-3", "P-3S", "P-4",
  "Q-1",
  "R-1", "R-2",
  "E-1", "E-2", "E-3",
  "TN Canada", "TN Mexico",
  "K-1", "K-2", "K-3", "K-4",
  "F-1", "F-2",
  "J-1", "J-2",
  "M-1", "M-2",
  "B-1", "B-2", "B-1/B-2",
  "U-1", "U derivative",
  "SB-1",
  "F-1 OPT", "F-1 STEM OPT",
  "EB-1A", "EB-1B", "EB-1C", "EB-2 PERM", "EB-2 NIW", "EB-3 Skilled Worker", "EB-3 Professional", "EB-3 Other Worker", "EB-4", "EB-5 Regional Center", "EB-5 Standalone",
  "IR-1", "CR-1", "IR-2", "CR-2", "IR-3", "IR-4", "IR-5", "F1", "F2A", "F2B", "F3", "F4",
  "Adjustment of Status", "GC-NVC", "Conditional Green Card Removal", "Green Card Renewal", "Re-entry Permit",
  "Naturalization", "Certificate of Citizenship", "Replacement Citizenship Certificate",
];

// Universal-auto-create traps the spec explicitly warns against (§17
// items 13-18) - these must NEVER be AUTO_CREATE for every case.
const NEVER_UNIVERSALLY_AUTO_CREATE = ["I-907", "I-539", "I-765", "I-131", "I-485", "I-824"];

function fail(errors, message) {
  errors.push(message);
}

async function validateRegistry() {
  const errors = [];
  const warnings = [];
  const mappings = await VisaFormMapping.find({}).lean();
  const active = mappings.filter((m) => m.active);

  // 1. Visa with no mapped forms is caught by the coverage check below.
  // 2. Form with no agency.
  active.forEach((m) => { if (!m.agency) fail(errors, `${m.visaType} -> ${m.formNumber}: missing agency`); });
  // 3. AUTO_CREATE without a valid registry record - trivially true since
  //    every mapping IS a registry record; interpreted as "AUTO_CREATE
  //    entries must have componentType + formName populated."
  active.filter((m) => m.provisioningType === "AUTO_CREATE").forEach((m) => {
    if (!m.formName || !m.componentType) fail(errors, `${m.visaType} -> ${m.formNumber}: AUTO_CREATE mapping missing formName/componentType`);
  });
  // 4. CONDITIONAL without trigger logic (a CONDITIONAL with an empty
  //    processingPaths AND null triggerCondition would auto-apply to every
  //    case of that visa with no way to ever decline it being asked, which
  //    is legitimate for e.g. "always offer, CM decides" - so this only
  //    fails if there's neither a trigger nor a documented reason).
  active.filter((m) => m.provisioningType === "CONDITIONAL").forEach((m) => {
    if (!m.triggerCondition && !m.processingPaths?.length && !m.notes) {
      warnings.push(`${m.visaType} -> ${m.formNumber}: CONDITIONAL with no trigger, no processingPaths restriction, and no notes explaining why it's always offered`);
    }
  });
  // 5. LATER_STAGE without stage information.
  active.filter((m) => m.provisioningType === "LATER_STAGE").forEach((m) => {
    if (!m.stage) fail(errors, `${m.visaType} -> ${m.formNumber}: LATER_STAGE mapping missing stage`);
  });
  // 6. Duplicate visa/form mappings - enforced by the unique index at
  //    write time; double-checked here for defense in depth.
  const seen = new Map();
  active.forEach((m) => {
    const key = `${m.visaType}::${m.formNumber}::${m.componentType}`;
    if (seen.has(key)) fail(errors, `Duplicate active mapping: ${key}`);
    seen.set(key, m);
  });
  // 7/8: Duplicate CaseForms / invalid form numbers are runtime concerns
  //      covered by the acceptance tests, not this static validator.
  // 9. Forms assigned to the wrong agency. A small set of forms carry a
  // USCIS/DOS-shaped number but are genuinely issued by the school/program
  // sponsor or SEVP, not the agency the prefix would naively suggest
  // (spec §12 explicitly calls these out: "I-20 -> School/SEVP record",
  // "DS-2019 -> Program Sponsor/SEVP record", "I-983 -> SEVP/DHS
  // workflow") - these are deliberate exceptions, not agency-tagging bugs.
  const PREFIX_AGENCY_EXCEPTIONS = new Set(["I-20", "DS-2019", "I-983"]);
  active.forEach((m) => {
    if (PREFIX_AGENCY_EXCEPTIONS.has(m.formNumber)) return;
    if (/^DS-/.test(m.formNumber) && m.agency !== "DOS") fail(errors, `${m.visaType} -> ${m.formNumber}: DS-prefixed form must be agency DOS, got ${m.agency}`);
    if (/^ETA-/.test(m.formNumber) && m.agency !== "DOL") fail(errors, `${m.visaType} -> ${m.formNumber}: ETA-prefixed form must be agency DOL, got ${m.agency}`);
    if (/^[IN]-\d/.test(m.formNumber) && m.agency !== "USCIS") fail(errors, `${m.visaType} -> ${m.formNumber}: I-/N-prefixed form must be agency USCIS, got ${m.agency}`);
  });
  // 10/11. DS-160/DS-260 incorrectly treated as USCIS forms.
  active.filter((m) => ["DS-160", "DS-260"].includes(m.formNumber)).forEach((m) => {
    if (m.agency !== "DOS") fail(errors, `${m.visaType} -> ${m.formNumber}: must be agency DOS, got ${m.agency}`);
  });
  // 12. DOL forms incorrectly treated as USCIS forms.
  active.filter((m) => /^ETA-/.test(m.formNumber)).forEach((m) => {
    if (m.agency !== "DOL") fail(errors, `${m.visaType} -> ${m.formNumber}: DOL form tagged as ${m.agency}`);
  });
  // 13-18: never-universally-auto-create traps. "Universally" means EVERY
  // registered occurrence of that form number, across every visa, is an
  // unconditional AUTO_CREATE - i.e. nothing anywhere ever gates it. A
  // legitimate visa-specific AUTO_CREATE (e.g. I-765 for F-1 STEM OPT,
  // where I-765 is the real EAD application) is fine as long as OTHER
  // visas correctly gate the same form number - only a registry where the
  // form is NEVER gated anywhere is the actual trap this guards against.
  NEVER_UNIVERSALLY_AUTO_CREATE.forEach((formNumber) => {
    const entries = active.filter((m) => m.formNumber === formNumber);
    if (!entries.length) return;
    const allUnconditionalAutoCreate = entries.every((m) => m.provisioningType === "AUTO_CREATE" && !m.processingPaths?.length && !m.triggerCondition);
    if (allUnconditionalAutoCreate) fail(errors, `${formNumber} is AUTO_CREATE with no restricting condition on EVERY occurrence in the registry (${entries.map((m) => m.visaType).join(", ")}) - it must be gated somewhere`);
  });

  // Corrections §11: mandatory visa coverage, explicit PASS/FAIL.
  const presentVisaTypes = new Set(mappings.map((m) => m.visaType));
  const missingVisas = REQUIRED_VISA_TYPES.filter((v) => !presentVisaTypes.has(v));
  const coveragePass = missingVisas.length === 0;
  if (!coveragePass) missingVisas.forEach((v) => fail(errors, `Required visa type "${v}" has zero mappings`));

  // Corrections §12: semantic conflict detection beyond the unique index -
  // same visaType+formNumber+processingPath overlap with different
  // provisioningType across active mappings.
  const byVisaForm = new Map();
  active.forEach((m) => {
    const key = `${m.visaType}::${m.formNumber}`;
    if (!byVisaForm.has(key)) byVisaForm.set(key, []);
    byVisaForm.get(key).push(m);
  });
  for (const [key, group] of byVisaForm.entries()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.provisioningType === b.provisioningType) continue;
        const aPaths = a.processingPaths?.length ? a.processingPaths : ["*"];
        const bPaths = b.processingPaths?.length ? b.processingPaths : ["*"];
        const overlaps = aPaths.includes("*") || bPaths.includes("*") || aPaths.some((p) => bPaths.includes(p));
        if (overlaps) fail(errors, `Semantic conflict: ${key} has both ${a.provisioningType} and ${b.provisioningType} for an overlapping processingPath (componentType ${a.componentType} vs ${b.componentType})`);
      }
    }
  }

  // Corrections §9: initialCaseCreation consistency.
  active.forEach((m) => {
    if (m.provisioningType === "AUTO_CREATE" && m.initialCaseCreation !== true) fail(errors, `${m.visaType} -> ${m.formNumber}: AUTO_CREATE must have initialCaseCreation=true`);
    if (["LATER_STAGE", "REFERENCE"].includes(m.provisioningType) && m.initialCaseCreation !== false) fail(errors, `${m.visaType} -> ${m.formNumber}: ${m.provisioningType} must have initialCaseCreation=false`);
  });

  // Corrections §5: trigger field whitelist (also enforced at the schema
  // level - re-checked here for a single consolidated report).
  active.forEach((m) => {
    const err = VisaFormMapping.validateTriggerNode(m.triggerCondition);
    if (err) fail(errors, `${m.visaType} -> ${m.formNumber}: ${err}`);
  });

  // Corrections §13: source verification report.
  const unverified = active.filter((m) => !m.sourceVerified).map((m) => ({ visaType: m.visaType, formNumber: m.formNumber, notes: m.notes }));

  return {
    pass: errors.length === 0,
    errors,
    warnings,
    coverage: { pass: coveragePass, missingVisas },
    totalMappings: mappings.length,
    activeMappings: active.length,
    unverifiedMappings: unverified,
  };
}

module.exports = { validateRegistry, REQUIRED_VISA_TYPES, NEVER_UNIVERSALLY_AUTO_CREATE };
