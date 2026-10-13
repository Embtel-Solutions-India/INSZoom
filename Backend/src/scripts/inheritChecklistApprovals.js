// node src/scripts/inheritChecklistApprovals.js [--apply]
// Every employee case inherits the approval its principal (employer) case already gave to the employee checklist - for every visa type.
// Dry run by default (lists what would change); --apply writes. Idempotent.
require("dotenv").config();
const mongoose = require("mongoose");
const env = require("../config/env");
const Case = require("../models/Case");
const { inheritParentApprovals } = require("../modules/questionnaires/case-checklist.service");

const apply = process.argv.includes("--apply");
mongoose
  .connect(env.mongoUri)
  .then(async () => {
    const principals = await Case.find({ "checklistApproval.approvals.checklistId": /\|employee$/ }).select("_id caseNumber visaType").lean();
    let total = 0;
    for (const principal of principals) {
      const children = await Case.find({ parentCase: principal._id }).select("_id caseNumber checklistApproval.approvals.checklistId checklistApproval.required").lean();
      const parent = await Case.findById(principal._id).select("checklistApproval.approvals.checklistId").lean();
      const parentIds = (parent.checklistApproval.approvals || []).map((a) => a.checklistId).filter((id) => /\|employee$/.test(id));
      const pending = children.filter((child) => child.checklistApproval?.required && parentIds.some((id) => !(child.checklistApproval.approvals || []).some((a) => a.checklistId === id)));
      if (!pending.length) continue;
      console.log(principal.caseNumber, principal.visaType, "->", pending.map((c) => c.caseNumber).join(", "));
      if (apply) total += (await inheritParentApprovals(principal._id)).inherited;
    }
    console.log(apply ? `inherited ${total} approval(s)` : "dry run - use --apply");
  })
  .then(() => mongoose.disconnect())
  .then(() => process.exit(0))
  .catch((error) => { console.error("Failed:", error.stack || error.message); process.exit(1); });
