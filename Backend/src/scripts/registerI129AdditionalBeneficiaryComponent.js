// I-129 pages 37-38 ("Part 9. Additional Beneficiary Information" - a
// continuation sheet used only when a petition lists more than one
// beneficiary) are a genuine part of the base I-129 PDF but are NOT one of
// "Parts 1-8" that make up the ordinary single-beneficiary core petition,
// and are NOT a visa-classification supplement (no VisaFormMapping row
// exists or should exist for them - no visa "requires" Part 9, it's a
// beneficiary-count-driven continuation sheet). Because
// USCISFormComponentDiscoveryService only discovers components from
// VisaFormMapping's own SUPPLEMENT/FORM_COMPONENT rows (see that file's own
// banner comment), Part 9 is registered here instead, directly, as a
// one-off idempotent script - not wired into any VisaFormMapping row, so it
// is never auto-created as a CaseForm by ensureAssignedForms/
// registryAutoCreateTemplates. Its only effect is to make
// ComponentPageResolver.resolveCorePages() correctly exclude pages 37-38
// from the core I-129 CaseForm's page list (which otherwise, being
// unclaimed by any of the 8 real classification-supplement components,
// would incorrectly fall into "core").
//
// Re-run this whenever a new I-129 edition is imported (parentTemplateId
// changes) - idempotent via upsert on (parentTemplateId, componentCode),
// same convention as USCISFormComponentDiscoveryService's own
// upsertDefinition().
require("dotenv").config();
const mongoose = require("mongoose");

const COMPONENT_CODE = "I129_ADDITIONAL_BENEFICIARY";

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGODB_TEST_URI);
  const USCISFormTemplate = require("../models/USCISFormTemplate");
  const USCISFormComponentDefinition = require("../models/USCISFormComponentDefinition");

  const template = await USCISFormTemplate.findOne({ formCode: /^I-129$/i, status: "active" });
  if (!template) {
    console.error("No active I-129 USCISFormTemplate found - aborting.");
    process.exit(1);
  }

  const totalPages = template.pdfMetadata?.pageCount;
  if (!totalPages) {
    console.error("Active I-129 template has no pdfMetadata.pageCount - aborting.");
    process.exit(1);
  }
  // Part 9 is always the final continuation sheet(s), immediately after the
  // last currently-registered ACTIVE component's own claimed pages - never
  // hardcoded to "37-38", so this stays correct if a future edition shifts
  // page numbers.
  const activeComponents = await USCISFormComponentDefinition.find({ parentTemplateId: template._id, status: "ACTIVE" }).lean();
  const lastClaimedPage = activeComponents.reduce((max, def) => {
    const defMax = (def.pageRanges || []).reduce((m, r) => Math.max(m, r.endPage), 0);
    return Math.max(max, defMax);
  }, 0);
  const startPage = lastClaimedPage + 1;
  const endPage = totalPages;
  if (startPage > endPage) {
    console.log(`No trailing pages after the last claimed component page (${lastClaimedPage}) - nothing to register.`);
    await mongoose.disconnect();
    return;
  }

  const doc = await USCISFormComponentDefinition.findOneAndUpdate(
    { parentTemplateId: template._id, componentCode: COMPONENT_CODE },
    {
      $set: {
        parentFormCode: "I-129",
        parentTemplateId: template._id,
        templateVersion: template.version,
        componentCode: COMPONENT_CODE,
        name: "Additional Beneficiary Information",
        componentType: "FORM_COMPONENT",
        pageRanges: [{ startPage, endPage }],
        fieldIds: (template.formFields || [])
          .filter((f) => f.pageNumber != null && f.pageNumber >= startPage && f.pageNumber <= endPage)
          .map((f) => f.fieldId || f.fieldName)
          .filter(Boolean),
        status: "ACTIVE",
        discoverySource: "registerI129AdditionalBeneficiaryComponent.js",
        discoveredAt: new Date(),
        verificationMethod: "manual_registration_not_visa_driven",
      },
      $unset: { reviewReason: "" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  console.log("Registered:", doc.componentCode, JSON.stringify(doc.pageRanges), "fieldCount:", doc.fieldIds.length);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().catch((error) => {
    console.error("SCRIPT FAILED:", error);
    process.exit(1);
  });
}

module.exports = { run };
