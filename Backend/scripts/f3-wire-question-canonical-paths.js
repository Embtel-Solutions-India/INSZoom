/**
 * f3-wire-question-canonical-paths.js
 *
 * F-3 fix for M4: the i129-h1b-crosswalk.js has 17 unique non-raw-prefixed
 * canonical source paths (company, person, contact, immigration namespace
 * paths resolved through CanonicalBuilderService.addQuestionnaireCandidates,
 * which requires question.mapping.canonicalPath to be set - unlike the
 * crosswalk's other 84 entries, which use raw.questionnaireAnswers.KEY.value
 * and are resolved directly by question key, no mapping needed).
 *
 * Cross-referencing the live DB found 16 of those 17 paths already wired
 * (14 on h1b_employee_checklist questions, 2 resolved from the Case
 * document itself via DATABASE_FIELD_MAP - case.visaType and person.fullName
 * via the linked User, both source-independent of Question.mapping).
 * The one real gap: "company.name" has no route to canonical data through
 * the questionnaire - h1b_employer_checklist's employer_company_fullName
 * question has no mapping.canonicalPath, and CanonicalBuilderService's only
 * fallback (QUESTION_KEY_MAP) keys on unnamespaced strings like "fullName",
 * not "employer_company_fullName", so it never matches.
 *
 * Idempotent - safe to run multiple times.
 * Run: node Backend/scripts/f3-wire-question-canonical-paths.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");
const Question = require("../src/models/Question");

const QUESTION_KEY_TO_CANONICAL_PATH = {
  employer_company_fullName: "company.name",
};

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected");

  for (const [key, canonicalPath] of Object.entries(QUESTION_KEY_TO_CANONICAL_PATH)) {
    const result = await Question.updateOne({ key }, { $set: { "mapping.canonicalPath": canonicalPath } });
    if (result.matchedCount === 0) {
      console.warn(`NOT FOUND: question key "${key}" - check the seeded key name before re-running`);
    } else {
      console.log(`OK: ${key} -> mapping.canonicalPath = "${canonicalPath}" (matched ${result.matchedCount}, modified ${result.modifiedCount})`);
    }
  }

  const verify = await Question.findOne({ key: "employer_company_fullName" }).select("key mapping").lean();
  console.log("\nVerification:", JSON.stringify(verify));

  await mongoose.disconnect();
  console.log("Done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
