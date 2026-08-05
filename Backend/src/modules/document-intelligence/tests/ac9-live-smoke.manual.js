// Phase H2 AC9 — live smoke test. NOT picked up by `npm test` (this file
// doesn't match *.test.js on purpose): it calls the REAL Gemini provider via
// the real classifier/extractor/matcher, costs real API quota, and depends
// on network access - exactly the "run once, real key + real sample doc"
// exception the task itself calls for, not a permanent CI test.
//
// Run with: node src/modules/document-intelligence/tests/ac9-live-smoke.manual.js <path-to-passport-image>
//
// Builds a real H-1B case (reusing form-mapping's golden-case fixture for
// speed), clears the passport-derived answers so they start empty, uploads
// the real sample document through the real uploadAndExtractNow path, and
// reports which target fields came back applied. Cleans up all test data
// (case/beneficiary/company/user/document/extraction/answers) afterward,
// regardless of outcome - this handles a real, sensitive ID photo and
// shouldn't leave it (or values extracted from it) sitting in the database.
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const env = require("../../../config/env");

const Answer = require("../../../models/Answer");
const Document = require("../../../models/Document");
const DocumentExtraction = require("../../../models/DocumentExtraction");
const service = require("../services/document-intelligence.service");
const { buildGoldenH1bCase } = require("../../form-mapping/tests/i129-h1b-golden-case");

const TARGET_KEYS = [
  "employee_personal_firstName",
  "employee_personal_lastName",
  "employee_personal_middleName",
  "employee_personal_dateOfBirth",
  "employee_personal_passportNumber",
];

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath || !fs.existsSync(imagePath)) {
    console.error("Usage: node ac9-live-smoke.manual.js <path-to-passport-image>");
    process.exit(1);
  }
  await mongoose.connect(env.mongoUri);

  const golden = await buildGoldenH1bCase();
  let extractionId;
  let documentId;
  try {
    await Answer.deleteMany({ caseId: golden.caseId, questionKey: { $in: TARGET_KEYS } });

    const buffer = fs.readFileSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const mimetype = ext === ".png" ? "image/png" : "image/jpeg";

    const extraction = await service.uploadAndExtractNow({
      file: { originalname: path.basename(imagePath), mimetype, buffer },
      body: { caseId: String(golden.caseId), documentType: "passport" },
      user: golden.user,
      req: {},
    });
    extractionId = extraction._id;
    documentId = extraction.documentId;

    console.log("classification:", extraction.classification?.documentType, "confidence:", extraction.classification?.confidence);
    console.log("extractedData keys:", (extraction.extractedData || []).map((f) => f.key));
    console.log("questionnairePrefill:");
    (extraction.questionnairePrefill || []).forEach((item) => {
      console.log(`  ${item.key} -> applied=${item.applied} conflict=${item.conflict} confidence=${item.confidence} targetSystem=${item.targetSystem}`);
    });

    const appliedKeys = new Set((extraction.questionnairePrefill || []).filter((i) => i.applied).map((i) => i.key));
    console.log("\n--- AC9 target coverage ---");
    for (const key of TARGET_KEYS) {
      console.log(`  ${key}: ${appliedKeys.has(key) ? "APPLIED" : "not applied"}`);
    }
  } finally {
    if (extractionId) await DocumentExtraction.deleteOne({ _id: extractionId });
    if (documentId) await Document.deleteOne({ _id: documentId });
    await golden.cleanup();
    await mongoose.disconnect();
  }
}

main().catch(async (error) => {
  console.error("AC9 live smoke test failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
