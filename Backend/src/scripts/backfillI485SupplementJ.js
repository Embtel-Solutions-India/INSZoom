// node src/scripts/backfillI485SupplementJ.js [--apply]
// (or: npm run backfill:i485supj -- --apply, from Backend/)
//
// Gives every EXISTING case of an eligible type its I-485 Supplement J (form code I-485J) - new cases get it
// automatically at creation via ensureAssignedForms; this closes the gap for cases created before the form existed.
// It reuses the one provisioning path (ensureAssignedForms -> VisaFormMapping registry), so eligibility is decided by
// the registry rows alone and nothing is hard-coded here. Idempotent: a case that already has the form is skipped.
// Dry run by default; pass --apply to write.
const mongoose = require("mongoose");
const env = require("../config/env");
const Case = require("../models/Case");
const CaseForm = require("../models/CaseForm");
const VisaFormMapping = require("../models/VisaFormMapping");
const User = require("../models/User");
const uscisFormService = require("../modules/uscis-forms/uscis-form.service");

const FORM_CODE = "I-485J";

async function run({ apply }) {
  const eligibleVisaTypes = await VisaFormMapping.distinct("visaType", { formTemplateFormCode: FORM_CODE.toLowerCase(), active: true });
  const cases = await Case.find({ visaType: { $in: eligibleVisaTypes } });
  const actor = (await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 })) || { _id: undefined, role: "super_admin" };
  const summary = { eligibleVisaTypes, considered: cases.length, alreadyHad: 0, added: 0, notApplicable: 0, failed: [] };

  for (const caseData of cases) {
    const has = await CaseForm.exists({ caseId: caseData._id, formCode: FORM_CODE });
    if (has) { summary.alreadyHad += 1; continue; }
    if (!apply) { summary.added += 1; continue; }
    try {
      await uscisFormService.ensureAssignedForms(caseData, actor, null, {});
      if (await CaseForm.exists({ caseId: caseData._id, formCode: FORM_CODE })) summary.added += 1;
      else summary.notApplicable += 1; // e.g. the case's processing path is not adjustment of status
    } catch (error) {
      summary.failed.push({ caseId: String(caseData._id), error: error.message });
    }
  }
  return summary;
}

module.exports = run;

if (require.main === module) {
  const apply = process.argv.includes("--apply");
  mongoose
    .connect(env.mongoUri)
    .then(() => run({ apply }))
    .then((summary) => {
      console.log(apply ? "I-485J backfill APPLIED:" : "I-485J backfill DRY RUN (use --apply to write):");
      console.log(JSON.stringify(summary, null, 2));
    })
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error("I-485J backfill failed:", error.message);
      await mongoose.disconnect().catch(() => {});
      process.exit(1);
    });
}
