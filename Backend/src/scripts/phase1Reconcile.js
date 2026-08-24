// Phase 1 (USCIS-forms re-architecture) reconciliation report generator. Read-only: loads each
// seeded template's real, persisted formFields and runs reconciliationAnalyzer against the
// matching crosswalk, then writes docs/forms/PHASE1_RECONCILIATION.md. Never mutates formFields
// or a crosswalk config.
require("dotenv").config();

// MONGODB_TEST_URI must win over dotenv's .env-loaded MONGODB_URI when explicitly set - see
// docs/forms/PHASE1_RUN_JOURNAL.md's Atlas-accident writeup for why the priority order matters.
if (!process.env.LOCAL_STORAGE_PATH) {
  process.env.LOCAL_STORAGE_PATH = require("path").resolve(__dirname, "..", "..", "storage");
}

const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const env = require("../config/env");
const USCISFormTemplate = require("../models/USCISFormTemplate");
const { reconcileForm } = require("../modules/form-mapping/tests/phase1/reconciliationAnalyzer");

const i129h1bCrosswalk = require("../modules/form-mapping/config/i129-h1b-crosswalk");
const i129fK1Crosswalk = require("../modules/form-mapping/config/i129f-k1-crosswalk");
const i130K3Crosswalk = require("../modules/form-mapping/config/i130-k3-crosswalk");

const FORMS = [
  { formLabel: "I-129 (H-1B / L-1A / L-1B, shared crosswalk)", formCode: "I-129", crosswalk: i129h1bCrosswalk },
  { formLabel: "I-129F (K-1)", formCode: "I-129F", crosswalk: i129fK1Crosswalk },
  { formLabel: "I-130 (K-3)", formCode: "I-130", crosswalk: i130K3Crosswalk },
];

async function connect() {
  const uri = process.env.MONGODB_TEST_URI || process.env.MONGODB_URI || env.mongoUri;
  await mongoose.connect(uri);
  console.log(`Connected to MongoDB host="${mongoose.connection.host}" db="${mongoose.connection.name}"`);
}

function renderTable(rows, columns) {
  if (!rows.length) return "_None._\n";
  const header = `| ${columns.join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((col) => String(row[col] ?? "").replace(/\|/g, "\\|")).join(" | ")} |`).join("\n");
  return `${header}\n${divider}\n${body}\n`;
}

function renderFormSection(result) {
  const lines = [];
  lines.push(`## ${result.formLabel}`);
  lines.push("");
  lines.push(`- Real AcroForm fields on the current template: **${result.fieldCount}**`);
  lines.push(`- Crosswalk-mapped edges: **${result.mappedEdgeCount}**`);
  lines.push(`- unmapped-required-field: **${result.unmappedRequiredFields.length}**`);
  lines.push(`- dangling-mapping: **${result.danglingMappings.length}**`);
  lines.push(`- semantic-type-mismatch: **${result.semanticTypeMismatches.length}**`);
  lines.push("");
  lines.push("### unmapped-required-field");
  lines.push("A real, `required=true` AcroForm field with no crosswalk mapping at all - always renders blank on the generated PDF.");
  lines.push("");
  lines.push(renderTable(result.unmappedRequiredFields, ["fieldName", "classification", "note"]));
  lines.push("### dangling-mapping");
  lines.push("A crosswalk edge whose target field does not exist on the CURRENT template - the template PDF drifted since this crosswalk was authored, or the edge has a typo.");
  lines.push("");
  lines.push(renderTable(result.danglingMappings, ["fieldName", "source", "note"]));
  lines.push("### semantic-type-mismatch (candidates for Phase 2)");
  lines.push("A mapped edge whose transform disagrees with the field's own scanner-inferred `semanticType`/`pdfFieldType`. Flagged as a candidate, not asserted wrong.");
  lines.push("");
  const dateSubclassCount = result.semanticTypeMismatches.filter((m) => m.subclass === "date-field-without-date-transform").length;
  if (dateSubclassCount) {
    lines.push(
      `> **Root-cause note, not ${dateSubclassCount} independent findings:** every ` +
        "`date-field-without-date-transform` row below traces back to ONE pre-existing bug in " +
        "`PDFFieldScannerService.inferTextSemanticType()` (`Backend/src/modules/uscis-form-import/services/PDFFieldScannerService.js:80-93`): " +
        'its regex `/date|dob|birth|expiry|expires|issued|from|to/` (a) matches the bare substrings ' +
        '"to"/"from" with no word boundary (e.g. "Line_Ci**tyTo**wn" and "Passportor**Tra**vDoc" both ' +
        'contain "to"), and (b) matches "birth" for ANY birth-related field, not only date-of-birth ' +
        '("CountryOfBirth"/"CityTownOfBirth"/"ProvinceOrStateOfBirth" are place-name text fields, not ' +
        "dates. Characterized-only here (fixing the scanner's regex is extraction code, out of Phase " +
        "1 scope) - see the ledger entry in `docs/forms/PHASE1_RUN_JOURNAL.md`. **Practical impact: " +
        "`semanticType===\"date\"` cannot be trusted at face value for birth-place-shaped field names " +
        "until this is fixed** - Phase 2's semantic enforcement should special-case or re-derive this " +
        "rather than reusing the scanner's raw semanticType unconditionally for country/city-of-birth " +
        "fields."
    );
    lines.push("");
  }
  lines.push(renderTable(result.semanticTypeMismatches, ["fieldName", "source", "subclass", "note"]));
  return lines.join("\n");
}

async function main() {
  await connect();
  const sections = [];
  for (const form of FORMS) {
    const template = await USCISFormTemplate.findOne({ formCode: form.formCode }).select("formFields").lean();
    if (!template) {
      sections.push(`## ${form.formLabel}\n\n_No seeded template found for formCode="${form.formCode}" - skipped._\n`);
      continue;
    }
    const result = reconcileForm({ formLabel: form.formLabel, formFields: template.formFields, crosswalk: form.crosswalk });
    sections.push(renderFormSection(result));
    console.log(`${form.formLabel}: ${result.unmappedRequiredFields.length} unmapped-required, ${result.danglingMappings.length} dangling, ${result.semanticTypeMismatches.length} semantic-mismatch`);
  }

  const doc = `# Phase 1 Reconciliation Report — Authoritative formFields vs Crosswalk Mappings

Read-only cross-reference of each seeded template's real, persisted \`USCISFormTemplate.formFields\`
(the authoritative AcroForm dictionary - see \`docs/forms/PHASE1_BASELINE.md\`) against its
crosswalk's hand-reviewed \`MAPPED_EDGES\`. Report-only: nothing here is auto-fixed. Actionable
findings are carried into \`docs/forms/PHASE1_RUN_JOURNAL.md\`'s ledger entries. Corrections belong
to Phase 2 (mapping/semantic fixes) or later, per the Phase 1 scope guard.

${sections.join("\n\n")}
`;

  const outPath = path.resolve(__dirname, "..", "..", "..", "docs", "forms", "PHASE1_RECONCILIATION.md");
  fs.writeFileSync(outPath, doc, "utf8");
  console.log(`\nWrote ${outPath}`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("phase1Reconcile failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
