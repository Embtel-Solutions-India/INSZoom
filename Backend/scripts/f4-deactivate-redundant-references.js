/**
 * f4-deactivate-redundant-references.js
 *
 * B003/B003-A each carry 2 extra active questionnaireReferences beyond the
 * real, UI-driven h1b_employer_checklist / h1b_employee_checklist:
 *   - "h1b_questionnaire" - a legacy, pre-Phase-9 monolithic H-1B intake
 *     questionnaire (mixes employer AND employee fields in one form -
 *     employerName/jobTitle alongside fullName/degreeLevel). Superseded by
 *     the split employer/employee checklists actually used by this
 *     architecture. Its required file questions (educationEvidence,
 *     employmentEvidence) are the source of the "Education"/"Employment"
 *     checklist items that showed up with no real upload path.
 *   - "uscis_library_aa1c430ee011a3dabd05" - module "uscis_forms" (373
 *     questions), a form-mapping reference/definition library, not a
 *     client-facing checklist. applicableQuestionnaires()'s own module
 *     filter (module: {$in: ["cases","clients"]}) should exclude it, but it
 *     was assigned before that filter existed or via a different path, and
 *     nothing currently retires a stale reference when a questionnaire no
 *     longer qualifies.
 *
 * Deactivates (active: false) both references on B003/B003-A - answers and
 * the reference record itself are preserved, matching the schema's own
 * documented soft-remove convention (questionnaireReferenceSchema.active).
 *
 * Run: node Backend/scripts/f4-deactivate-redundant-references.js
 */
"use strict";

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const mongoose = require("mongoose");

const REDUNDANT_KEYS = new Set(["h1b_questionnaire", "uscis_library_aa1c430ee011a3dabd05"]);

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log("Connected\n");

  const Case = require("../src/models/Case");
  const Questionnaire = require("../src/models/Questionnaire");
  const ImmigrationKnowledgeEngineService = require("../src/modules/cases/immigration-knowledge-engine.service");

  const cases = await Case.find({ caseNumber: { $in: ["B003", "B003-A"] } });

  for (const caseDoc of cases) {
    console.log(`\n${caseDoc.caseNumber}`);
    const expectedRole = ImmigrationKnowledgeEngineService.expectedChecklistRoleForCase(caseDoc);
    for (const ref of caseDoc.questionnaireReferences) {
      if (!ref.active) continue;
      const questionnaire = ref.questionnaireId ? await Questionnaire.findById(ref.questionnaireId).select("key checklistRole").lean() : null;
      if (questionnaire && REDUNDANT_KEYS.has(questionnaire.key)) {
        ref.active = false;
        console.log(`  deactivated (redundant/legacy): ${questionnaire.key}`);
        continue;
      }
      // Same cross-role contamination as checklistItems (fixed at the
      // source in questionnaireApplies) - a reference already assigned
      // before that fix, for the wrong role, blocks questionnaireComplete
      // forever since it can never be filled by this case's own user.
      if (questionnaire?.checklistRole && expectedRole && questionnaire.checklistRole !== expectedRole && ref.status !== "completed") {
        ref.active = false;
        console.log(`  deactivated (wrong role - expected ${expectedRole}): ${questionnaire.key} (${questionnaire.checklistRole})`);
      }
    }
    await caseDoc.save();
  }

  await mongoose.disconnect();
  console.log("\nDone.");
}

main().catch((err) => { console.error(err); process.exit(1); });
