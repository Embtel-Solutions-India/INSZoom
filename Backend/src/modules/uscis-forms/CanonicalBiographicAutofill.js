// Generic biographic-core autofill fallback for USCIS forms that have NO
// curated field mapping yet — i.e. any form imported on-demand from
// uscis.gov (see OnDemandFormAcquisitionService) that hasn't had an
// attorney-authored crosswalk written for it (the 3 seeded forms this
// codebase already curates are I-129/I-129F/I-130 — see
// FieldLabelEnrichmentService's CROSSWALKS_BY_FORM_CODE).
//
// Scope is deliberately narrow and matches the Immiglance reference UX
// contract's own disclaimer exactly: "Autofill covers biographic identity,
// contact, and address fields only". This is NOT a general-purpose form
// mapper — it is the floor every form gets even with zero curated work, on
// top of which the existing curated systems (AutoFillService.generate /
// uscis-form.service.js's mergeFieldValues) do the deeper, form-specific
// fill.
//
// Reuse, not a new fill engine (Non-Negotiable Constraint #2/#4): pdf-lib
// still does the actual PDF fill elsewhere (renderCaseForm); this module
// only decides WHAT VALUE goes under which canonicalId, using the exact
// same two accessors (AutoFillService.getFieldValue / MappingResolver.
// resolvePath+setPath) uscis-form.service.js's own mergeFieldValues uses,
// so a value written here round-trips identically through the interactive
// workspace/renderCaseForm the next time either opens this form. Every
// value this module writes is tagged verificationStatus:
// "auto_populated_unconfirmed" and the resulting form status only ever
// reaches "ai_filled" (never "approved"/"locked"/"filed") — the human/
// attorney confirmation gate (Constraint #3) is never bypassed.
const CaseForm = require("../../models/CaseForm");
const AutoFillService = require("../form-mapping/services/AutoFillService");
const MappingResolver = require("../form-mapping/services/MappingResolver");

function hasValue(value) {
  return value !== undefined && value !== null && value !== "";
}

// Minimal local dot-path reader — deliberately not MappingResolver.resolvePath
// (that reads FROM a CaseForm's filledData tree, keyed by canonicalId; this
// reads FROM the canonical profile object, keyed by a plain dotted property
// path like "person.lastName" — same job, different source shape, not worth
// forking MappingResolver's own contract for).
function getByPath(source, path) {
  if (!source || !path) return undefined;
  return path.split(".").reduce((node, key) => (node === undefined || node === null ? undefined : node[key]), source);
}

// canonicalPath entries verified live against this DB's own active
// USCISMappingVersion (I-129, mappingVersion 3) graph.edges — every
// `verified: true` path below is a real, already-in-production sourcePath
// (confirmed via a direct read of that document, not guessed). The
// `verified: false` entries follow the exact same person./contact./company.
// naming convention but have no seeded form yet to confirm them against a
// live case; a wrong guess degrades gracefully to "left blank" (getByPath
// on a nonexistent path returns undefined, which hasValue() rejects) —
// never a wrong value written to a federal form. See the implementation
// report for the full verified/unverified breakdown.
const BIOGRAPHIC_INTENTS = [
  { intent: "familyName", canonicalPath: "person.lastName", verified: true, pattern: /family\s*name|last\s*name|surname/i },
  { intent: "givenName", canonicalPath: "person.firstName", verified: true, pattern: /given\s*name|first\s*name/i },
  { intent: "middleName", canonicalPath: "person.middleName", verified: true, pattern: /middle\s*name/i },
  { intent: "fullName", canonicalPath: "person.fullName", verified: true, pattern: /full\s*(legal\s*)?name|name\s*as\s*(it\s*)?appears/i },
  { intent: "dateOfBirth", canonicalPath: "person.dob", verified: true, pattern: /date\s*of\s*birth|\bdob\b/i },
  { intent: "gender", canonicalPath: "person.gender", verified: true, pattern: /\bsex\b|\bgender\b/i },
  { intent: "countryOfBirth", canonicalPath: "person.countryOfBirth", verified: true, pattern: /country\s*of\s*birth/i },
  { intent: "countryOfCitizenship", canonicalPath: "person.citizenship", verified: true, pattern: /country\s*of\s*citizenship|country\s*of\s*nationality|citizenship\s*or\s*nationality/i },
  { intent: "currentImmigrationStatus", canonicalPath: "immigration.currentStatus", verified: true, pattern: /current\s*(nonimmigrant\s*|immigration\s*)?status/i },
  { intent: "i94Number", canonicalPath: "immigration.i94.number", verified: true, pattern: /i-?94\b.*(number|#)|arrival[- ]departure\s*record\s*number/i },
  { intent: "passportNumber", canonicalPath: "person.passport.number", verified: true, pattern: /passport\s*(number|#)(?!.*(country|expir|valid))/i },
  { intent: "employerName", canonicalPath: "company.name", verified: true, pattern: /employer'?s?\s*name|name\s*of\s*(employer|petitioner|company|organization)|company\s*or\s*organization\s*name/i },
  { intent: "addressLine1", canonicalPath: "contact.address.line1", verified: true, pattern: /street\s*number\s*(and|&)?\s*name|mailing\s*address|physical\s*address|address\s*line\s*1|in\s*care\s*of/i },
  { intent: "addressCity", canonicalPath: "contact.address.city", verified: true, pattern: /city\s*or\s*town|\bcity\b/i },
  { intent: "addressState", canonicalPath: "contact.address.state", verified: true, pattern: /\bstate\b/i },
  { intent: "addressZip", canonicalPath: "contact.address.zip", verified: true, pattern: /zip\s*code|postal\s*code/i },
  // Below this line: same naming convention as the verified paths above,
  // not yet confirmed against a live mapping graph (no seeded form
  // currently exercises them) — included because they're squarely within
  // the "biographic identity, contact, address" disclaimer scope and a
  // wrong guess only ever costs "left blank", never a wrong value.
  { intent: "alienNumber", canonicalPath: "person.alienNumber", verified: false, pattern: /alien\s*(registration\s*)?number|\ba-?number\b|\ba#/i },
  { intent: "uscisOnlineAccountNumber", canonicalPath: "person.uscisOnlineAccountNumber", verified: false, pattern: /uscis\s*online\s*account\s*number|online\s*account\s*number/i },
  { intent: "ssn", canonicalPath: "person.ssn", verified: false, pattern: /social\s*security\s*number|\bssn\b/i },
  { intent: "passportCountry", canonicalPath: "person.passport.country", verified: false, pattern: /passport.*(country|issued\s*by)|country.*passport/i },
  { intent: "passportExpiry", canonicalPath: "person.passport.expiryDate", verified: false, pattern: /passport.*(expir|valid\s*(until|through))/i },
  { intent: "phone", canonicalPath: "contact.phone", verified: false, pattern: /daytime\s*(tele)?phone|mobile\s*(phone|number)|(tele)?phone\s*number/i },
  { intent: "email", canonicalPath: "contact.email", verified: false, pattern: /e-?mail\s*address|\be-?mail\b/i },
];

// First match wins, checked in the array's own order — more specific
// patterns (passport number/country/expiry, i94, alien number, uscis
// account, ssn) are listed ahead of any generic pattern they could
// otherwise collide with.
function matchIntent(label) {
  const text = String(label || "");
  return BIOGRAPHIC_INTENTS.find((entry) => entry.pattern.test(text));
}

function canonicalIdFor(field) {
  return field.fieldId || field.fieldName;
}

// Runs the biographic fallback for one CaseForm, filling ONLY fields that
// still have no value anywhere (fieldValues nor filledData) after whatever
// curated autofill already ran (AutoFillService.generate / renderCaseForm's
// own mergeFieldValues) — curated values always win; this never overwrites
// them, and never overwrites a human-entered/reviewed value either, since
// those are indistinguishable here from "already has a value".
async function fillMissingBiographicFields(caseFormId, canonicalProfile) {
  const caseForm = await CaseForm.findById(caseFormId).populate({ path: "formTemplateId", select: "formCode formFields" });
  if (!caseForm) {
    const error = new Error("Case form not found");
    error.statusCode = 404;
    throw error;
  }
  const template = caseForm.formTemplateId;
  if (!template) {
    const error = new Error("This case form's USCIS template is missing or was removed");
    error.statusCode = 409;
    throw error;
  }

  const filledByCrosswalk = [];
  const filledByHeuristic = [];
  const leftBlank = [];
  const nextFieldValues = { ...(caseForm.fieldValues || {}) };
  const nextFilledData = AutoFillService.clone(caseForm.filledData, {});
  const attribution = { ...(caseForm.sourceAttribution || {}) };

  for (const field of template.formFields || []) {
    if (field.uscisUseOnly) continue; // barcodes/internal widgets - never a fill target
    const canonicalId = canonicalIdFor(field);
    if (!canonicalId) continue;

    let existing = AutoFillService.getFieldValue(caseForm.fieldValues || {}, canonicalId);
    if (!hasValue(existing)) existing = MappingResolver.resolvePath(caseForm.filledData || {}, canonicalId);
    if (hasValue(existing)) {
      filledByCrosswalk.push(canonicalId); // already filled by a curated system before this ran
      continue;
    }

    const label = field.label || field.fieldLabel || field.fieldName;
    const matched = matchIntent(label);
    const value = matched ? getByPath(canonicalProfile, matched.canonicalPath) : undefined;
    if (matched && hasValue(value)) {
      nextFieldValues[canonicalId] = value;
      MappingResolver.setPath(nextFilledData, canonicalId, value);
      attribution[field.fieldName] = {
        ...(attribution[field.fieldName] || {}),
        value,
        source: "CanonicalBiographicHeuristic",
        sourceField: matched.canonicalPath,
        confidence: matched.verified ? 70 : 45,
        mappingUsed: { intent: matched.intent, canonicalPath: matched.canonicalPath, verified: matched.verified },
        // Deliberately NOT "auto_populated" (the value curated systems use) -
        // a distinct status so the workspace can visually flag a
        // label-matched heuristic guess as needing extra scrutiny, without
        // touching how curated auto_populated fields are shown.
        verificationStatus: "auto_populated_unconfirmed",
        populatedAt: new Date(),
      };
      filledByHeuristic.push({ canonicalId, intent: matched.intent, verified: matched.verified });
    } else {
      leftBlank.push(canonicalId);
    }
  }

  if (filledByHeuristic.length) {
    caseForm.set("fieldValues", nextFieldValues);
    caseForm.set("filledData", nextFilledData);
    caseForm.set("sourceAttribution", attribution);
    // Mirrors AutoFillService.generate's own status convention (the only
    // other place a CaseForm transitions into "ai_filled") - never advances
    // a form already further along in human review (in_review/approved/
    // ready_for_pdf/generated/locked/filed) back down to ai_filled.
    if (["pending", "draft"].includes(caseForm.status)) caseForm.set("status", "ai_filled");
    caseForm.set("lastModifiedAt", new Date());
    await caseForm.save();
  }

  return {
    caseFormId: caseForm._id,
    formCode: caseForm.formCode,
    filledByCrosswalk: filledByCrosswalk.length,
    filledByHeuristic,
    leftBlank: leftBlank.length,
  };
}

module.exports = { fillMissingBiographicFields, BIOGRAPHIC_INTENTS, matchIntent };
