// node src/scripts/syncChecklistDefinitions.js o1b_employer_checklist o1b_employee_checklist o1_employer_checklist o1_employee_checklist
// Brings the stored template of each named built-in checklist in line with its code definition (visa scope, questions, canonical paths).
// Existing cases keep the checklist references, responses and answers they already have; only the template (and therefore NEW cases) changes.
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const { EMPLOYMENT_CHECKLIST_DEFINITIONS } = require("../modules/questionnaires/employmentChecklists");
const { reconcileDefinition } = require("../modules/questionnaires/questionnaire.service");

const keys = process.argv.slice(2);
mongoose
  .connect(env.mongoUri)
  .then(async () => {
    for (const key of keys) {
      const definition = EMPLOYMENT_CHECKLIST_DEFINITIONS.find((item) => item.key === key);
      if (!definition) { console.log(key, "NOT A BUILT-IN DEFINITION"); continue; }
      const result = await reconcileDefinition(definition, { role: "super_admin" }, { ip: "script", headers: {} });
      console.log(key, "synced", JSON.stringify(result && (result.summary || { id: String(result._id || result.questionnaireId || "") })).slice(0, 120));
    }
  })
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });
