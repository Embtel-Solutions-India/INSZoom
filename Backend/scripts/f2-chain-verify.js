/**
 * f2-chain-verify.js
 * F-2 Autofill Accuracy Certification — Chain Verification Script
 *
 * For a given case (principal + its employee child), builds the real
 * assembled canonical snapshot via CanonicalBuilderService (the same
 * builder AutoFillService/generateForms relies on) and checks, for every
 * entry in the I-129 H-1B crosswalk (MAPPED_EDGES), whether:
 *   1. a canonical value is resolvable at edge.source, and
 *   2. if a CaseForm already exists for the case, whether CaseForm.fieldValues[edge.fieldName]
 *      matches that canonical value.
 *
 * READ-ONLY: never writes to any collection. CanonicalBuilderService.build()
 * only assembles an in-memory snapshot; it is not persisted by this script.
 *
 * Usage: node scripts/f2-chain-verify.js --caseId <principalOrChildCaseId>
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const fs = require("fs");

const Case = require("../src/models/Case");
const CaseForm = require("../src/models/CaseForm");
require("../src/models/Question");
require("../src/models/EmployerProfile");
require("../src/models/EmployeeProfile");
require("../src/models/Beneficiary");
require("../src/models/Company");
require("../src/models/User");
require("../src/models/Document");
require("../src/models/DocumentExtraction");
const CanonicalBuilderService = require("../src/modules/canonical/services/CanonicalBuilderService");
const MappingResolver = require("../src/modules/form-mapping/services/MappingResolver");
const CROSSWALK = require("../src/modules/form-mapping/config/i129-h1b-crosswalk");
const EDGES = CROSSWALK.MAPPED_EDGES || [];

const args = process.argv.slice(2);
const CASE_ID_ARG = args[args.indexOf("--caseId") + 1] || null;

function resolveAt(profile, sourcePath) {
  try {
    const value = MappingResolver.resolvePath(profile, sourcePath);
    return value === undefined ? null : value;
  } catch (e) {
    return null;
  }
}

// F-4 fix: a real CaseForm's fieldValues keys are NOT the crosswalk's raw
// XFA field names (form1[0].#subform[0].Line3_CompanyorOrgName[0]) - the
// autofill pipeline sanitizes them to a flat, punctuation-free key prefixed
// by page number (page1.form10Subform0Line3CompanyorOrgName0), confirmed
// directly against B003-A's real, successfully-generated I-129 CaseForm.
// Comparing raw crosswalk names against fieldValues keys always produced
// 100% MISSING_IN_FORM, even for fields verified correctly populated by
// direct inspection. Normalizing both sides to bare lowercase alphanumerics
// (dropping any leading pageN./partN. prefix) matches them reliably without
// needing to reverse-engineer the exact sanitization rule.
function normalizeFieldKey(key) {
  return String(key).replace(/^page\d+\.|^part\d+\./i, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

// Phase 12 fix (P12-M1): a plain string-equality compare flagged 9 real,
// correctly-transformed values as MISMATCH (phone digits vs. formatted
// "(650) 555-0311", ISO date vs. a US-formatted one, "female" vs a
// capitalized/checkbox rendering, etc.) - all spot-checked by hand against
// the real CaseForm and confirmed correct. Rather than hard-code each of
// AutoFillService's individual transform functions here (fragile - this
// script would drift out of sync with the real transform logic the moment
// either changed), normalize both sides the same permissive way before
// comparing: strip formatting punctuation, compare digit-only for anything
// that looks like a phone number, and compare as dates when both sides
// parse as one. A value that still differs after this is a genuine mismatch
// worth investigating, not a formatting artifact.
function looksLikePhone(value) {
  const digits = String(value).replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 && /^[\d\s()+.-]+$/.test(String(value));
}

function valuesMatch(canonicalValue, storedValue) {
  if (storedValue === null || storedValue === undefined || storedValue === "") return false;
  const a = String(canonicalValue).trim();
  const b = String(storedValue).trim();
  if (a === b) return true;
  if (a.toLowerCase() === b.toLowerCase()) return true;
  if (looksLikePhone(a) && looksLikePhone(b)) {
    return a.replace(/\D/g, "") === b.replace(/\D/g, "");
  }
  const dateA = new Date(a);
  const dateB = new Date(b);
  if (!Number.isNaN(dateA.getTime()) && !Number.isNaN(dateB.getTime()) && /\d{4}|\d{1,2}[/-]\d{1,2}/.test(a) && /\d{4}|\d{1,2}[/-]\d{1,2}/.test(b)) {
    return dateA.toDateString() === dateB.toDateString();
  }
  // Boolean/checkbox-style values (Yes/No, true/false, Y/N) compared loosely.
  const truthy = new Set(["yes", "true", "y", "1"]);
  const falsy = new Set(["no", "false", "n", "0"]);
  const aBool = truthy.has(a.toLowerCase()) ? true : falsy.has(a.toLowerCase()) ? false : null;
  const bBool = truthy.has(b.toLowerCase()) ? true : falsy.has(b.toLowerCase()) ? false : null;
  if (aBool !== null && bBool !== null) return aBool === bBool;
  return false;
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  await mongoose.connect(uri);
  console.log("Database connected\n");

  let caseId = CASE_ID_ARG;
  if (!caseId) {
    const anyCase = await Case.findOne({ visaType: "H-1B", caseRole: "principal" }).lean();
    if (!anyCase) throw new Error("No H-1B principal case found to verify.");
    caseId = anyCase._id.toString();
  }

  const principal = await Case.findById(caseId).lean();
  if (!principal) throw new Error(`Case ${caseId} not found`);
  const child = await Case.findOne({ parentCase: principal._id, caseRole: "employee" }).lean();

  console.log(`Principal case: ${principal.caseNumber} (${principal._id})`);
  console.log(`Child case: ${child ? child.caseNumber + " (" + child._id + ")" : "NONE FOUND"}\n`);

  const employerBuild = await CanonicalBuilderService.build(principal._id.toString());
  const employeeBuild = child ? await CanonicalBuilderService.build(child._id.toString()) : null;

  const employerProfile = employerBuild.profile;
  const employeeProfile = employeeBuild ? employeeBuild.profile : null;

  const caseForm = await CaseForm.findOne({
    caseId: { $in: [principal._id, child?._id].filter(Boolean) },
  }).lean();
  const normalizedFieldValues = {};
  if (caseForm) {
    for (const [key, value] of Object.entries(caseForm.fieldValues || {})) {
      normalizedFieldValues[normalizeFieldKey(key)] = value;
    }
  }

  console.log(`CaseForm found: ${caseForm ? caseForm._id : "NONE — 0 CaseForms exist for this case"}`);
  console.log(`Crosswalk entries: ${EDGES.length}\n`);
  console.log("=".repeat(70));
  console.log("  CHAIN VERIFICATION — I-129 H-1B (canonical-snapshot mode)");
  console.log("=".repeat(70) + "\n");

  const results = { resolvable: 0, unresolvable: 0, formMatch: 0, formMismatch: 0, formMissing: 0 };
  const unresolvedByPrefix = {};
  const failures = [];

  for (const edge of EDGES) {
    const sourcePath = edge.source;
    if (!sourcePath) continue;
    const prefix = sourcePath.split(".")[0];

    // company.* / petitioner-side paths live on the employer (principal) build;
    // person.* / contact.* / immigration.* live on the employee (child) build.
    const employerVal = resolveAt(employerProfile, sourcePath);
    const employeeVal = employeeProfile ? resolveAt(employeeProfile, sourcePath) : null;
    const canonicalValue = employerVal !== null && employerVal !== undefined ? employerVal : employeeVal;

    const resolvable = canonicalValue !== null && canonicalValue !== undefined && canonicalValue !== "";
    if (resolvable) {
      results.resolvable++;
    } else {
      results.unresolvable++;
      unresolvedByPrefix[prefix] = (unresolvedByPrefix[prefix] || 0) + 1;
    }

    let formStatus = "NO_CASEFORM";
    if (caseForm) {
      const stored = normalizedFieldValues[normalizeFieldKey(edge.fieldName)];
      const storedValue = (stored && typeof stored === "object" && "value" in stored ? stored.value : stored) ?? null;
      if (resolvable) {
        const match = valuesMatch(canonicalValue, storedValue);
        formStatus = match ? "MATCH" : (storedValue === null ? "MISSING_IN_FORM" : "MISMATCH");
        if (match) results.formMatch++;
        else if (storedValue === null) results.formMissing++;
        else results.formMismatch++;
      }
    }

    if (!resolvable || formStatus === "MISMATCH" || formStatus === "MISSING_IN_FORM") {
      failures.push({ fieldName: edge.fieldName, sourcePath, canonicalValue, formStatus });
    }
  }

  console.log(`Resolvable canonical value found:   ${results.resolvable} / ${EDGES.length}`);
  console.log(`NO canonical value anywhere:         ${results.unresolvable} / ${EDGES.length}`);
  console.log("\nUnresolved-by-prefix breakdown (which canonical namespace has no data path):");
  Object.entries(unresolvedByPrefix)
    .sort((a, b) => b[1] - a[1])
    .forEach(([prefix, count]) => console.log(`  ${prefix}.*  ->  ${count} unresolved fields`));

  if (caseForm) {
    console.log(`\nCaseForm comparison:`);
    console.log(`  MATCH:            ${results.formMatch}`);
    console.log(`  MISMATCH:         ${results.formMismatch}`);
    console.log(`  MISSING_IN_FORM:  ${results.formMissing}`);
  } else {
    console.log(`\nNo CaseForm exists for this case — cannot compare against rendered PDF field values.`);
    console.log(`This means "Generate USCIS Forms" has never succeeded for this case (see readiness gates).`);
  }

  const report = {
    runAt: new Date().toISOString(),
    principalCaseId: principal._id.toString(),
    principalCaseNumber: principal.caseNumber,
    childCaseId: child?._id?.toString() || null,
    childCaseNumber: child?.caseNumber || null,
    caseFormId: caseForm?._id?.toString() || null,
    crosswalkTotal: EDGES.length,
    summary: results,
    unresolvedByPrefix,
    failures,
  };
  fs.writeFileSync(path.join(__dirname, "../../f2-chain-report.json"), JSON.stringify(report, null, 2));
  console.log("\nReport saved to f2-chain-report.json");

  process.exitCode = results.unresolvable > 0 || results.formMismatch > 0 || results.formMissing > 0 ? 1 : 0;
}

main()
  .catch((err) => {
    console.error("Chain verification failed:", err.message);
    console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
