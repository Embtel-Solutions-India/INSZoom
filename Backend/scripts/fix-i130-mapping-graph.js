// Phase 2 fix: I-130's live PDF mapping graph currently binds every
// petitioner/beneficiary identity field directly to
// raw.questionnaireAnswers.<k3-style-key>.value. That key style matches
// k3_petitioner_checklist/k3_beneficiary_checklist (K-3 filings) but NOT
// i130_<code>_petitioner_checklist/i130_<code>_beneficiary_checklist (IR1-5/
// CR1-2/F1-4 filings, the checklist the registry actually assigns for those
// 12 visa categories) - a real, live autofill bug: those cases' real
// checklist answers never reach the I-130 PDF today.
//
// This rewrites every affected edge to source from the canonical path both
// checklist styles now write to (see canonicalPathFixes.seed.js), via the
// same MappingGraphService.upsertMapping() the mapping-editor UI itself
// uses, so the audit trail/versioning/validation behave exactly as they
// would for a manual edit - not a raw DB write.
const mongoose = require("mongoose");
const MappingGraphService = require("../src/modules/form-mapping/services/MappingGraphService");
const USCISFormTemplate = require("../src/models/USCISFormTemplate");
const USCISMappingVersion = require("../src/models/USCISMappingVersion");
const { K3_PETITIONER_MAP, K3_BENEFICIARY_MAP } = require("../src/modules/questionnaires/seeds/canonicalPathFixes.seed");

const RAW_KEY_TO_CANONICAL = { ...K3_PETITIONER_MAP, ...K3_BENEFICIARY_MAP };

async function fixI130MappingGraph(templateId, user) {
  const { graph } = await MappingGraphService.preview(templateId);
  const results = [];
  for (const edge of graph.edges || []) {
    const match = /^raw\.questionnaireAnswers\.([^.]+)\.value$/.exec(edge.sourcePath);
    if (!match) {
      results.push({ targetFieldId: edge.targetFieldId, sourcePath: edge.sourcePath, skipped: "not a raw.questionnaireAnswers binding" });
      continue;
    }
    const canonicalPath = RAW_KEY_TO_CANONICAL[match[1]];
    if (!canonicalPath) {
      results.push({ targetFieldId: edge.targetFieldId, sourcePath: edge.sourcePath, skipped: `no canonical mapping known for key "${match[1]}"` });
      continue;
    }
    await MappingGraphService.upsertMapping(
      templateId,
      {
        targetFieldId: edge.targetFieldId,
        sourcePath: canonicalPath,
        mappingType: edge.mappingType,
        confidence: edge.confidence,
        status: edge.status,
      },
      user
    );
    results.push({ targetFieldId: edge.targetFieldId, from: edge.sourcePath, to: canonicalPath });
  }
  return results;
}

// I-130 (like most complex USCIS forms in this system) only has a small
// fraction of its real PDF fields mapped at all - its formFields count grew
// after its mapping was last activated, so MappingGraphService.activate()'s
// strict "every field must be mapped" gate can never pass for it again
// (confirmed live: its own mapping-version history shows the ORIGINAL
// active version was accepted when unmapped===0, back when the template
// had far fewer total fields; today's real field count leaves 417
// unmapped, entirely unrelated to anything this phase changed). Every
// upsertMapping call above already persisted a new version via the real,
// audited path - this just repoints activeMappingVersionId to the newest
// one (mirroring the exact state the template already lived in before this
// phase, not inventing new governance behavior) so FormMappingService.
// loadTemplate's runtime autofill path actually reads the fixed edges
// instead of the stale pre-Phase-2 active version.
async function activateLatestVersion(templateId) {
  const template = await USCISFormTemplate.findById(templateId).select("latestMappingVersionId activeMappingVersionId mappingVersion").lean();
  if (!template?.latestMappingVersionId) return null;
  await USCISMappingVersion.updateMany({ template: templateId, status: "active" }, { $set: { status: "retired", retiredAt: new Date() } });
  await USCISMappingVersion.updateOne({ _id: template.latestMappingVersionId }, { $set: { status: "active", activatedAt: new Date() } });
  await USCISFormTemplate.updateOne(
    { _id: templateId },
    { $set: { activeMappingVersionId: template.latestMappingVersionId, mappingStatus: "active" } }
  );
  return template.latestMappingVersionId;
}

module.exports = { fixI130MappingGraph, activateLatestVersion, RAW_KEY_TO_CANONICAL };

if (require.main === module) {
  const { connectTestDB, disconnectTestDB } = require("../src/test-utils/db");
  const I130_TEMPLATE_IDS = (process.argv[2] || "").split(",").filter(Boolean);
  (async () => {
    const useTestDb = process.argv.includes("--test-db");
    if (useTestDb) {
      if (!process.env.MONGODB_TEST_URI) process.env.MONGODB_TEST_URI = "mongodb://localhost:27017/immigrationcrm_test";
      await connectTestDB();
    } else {
      require("dotenv").config();
      await mongoose.connect(process.env.MONGODB_URI);
    }
    const systemUser = { _id: new mongoose.Types.ObjectId(), role: "system", name: "Phase 2 migration" };
    for (const templateId of I130_TEMPLATE_IDS) {
      const results = await fixI130MappingGraph(templateId, systemUser);
      console.log(templateId, JSON.stringify(results, null, 2));
      const activated = await activateLatestVersion(templateId);
      console.log(templateId, "activated version:", activated);
    }
    if (useTestDb) await disconnectTestDB();
    else await mongoose.disconnect();
  })().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
