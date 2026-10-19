const mongoose = require("mongoose");

// The Case Manager's explicit, persistent decision about one USCIS form (or one embedded component of a form) for ONE case.
//
// - decision "include": the form belongs on the case.  decision "exclude": it must not be created or restored, whatever an automatic rule says.
//   A missing row is NOT an exclusion - it means "no explicit decision" (and, once a case is under manual control, "not selected").
// - One row per (caseId, formCode, componentCode). componentCode is stored as null for a whole form, so the unique index below really is unique.
// - caseId is the case that OWNS the forms (for an employer / family container that is the child case: that is where CaseForms live).
// - The row never deletes or rewrites a CaseForm; it only governs whether one may be created and whether it counts as active.
//
// See docs/CASE_MANAGER_CONTROLLED_USCIS_FORMS_AND_AUTOFILL.md.

const historySchema = new mongoose.Schema(
  {
    action: { type: String, required: true }, // include | exclude | restore | waive | baseline | provisioned | provisioning_failed
    decision: String,
    reason: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
    caseRevision: Number,
    meta: mongoose.Schema.Types.Mixed, // e.g. { previousStatus } so a removed form can be restored to where it was
  },
  { _id: false }
);

const caseFormSelectionSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    formCode: { type: String, required: true, trim: true, uppercase: true },
    componentCode: { type: String, trim: true, default: null },
    parentFormCode: { type: String, trim: true, uppercase: true, default: null },
    formTitle: String,
    decision: { type: String, enum: ["include", "exclude"], required: true },
    // where the selection stands: selected (decided, nothing created yet) | pending_acquisition (template not imported / not safe yet) |
    // provisioned (a CaseForm exists) | removed (excluded; its CaseForm, if any, is kept but archived) | failed (provisioning was attempted and failed)
    selectionStatus: { type: String, enum: ["selected", "pending_acquisition", "provisioned", "removed", "failed"], default: "selected" },
    caseFormId: { type: mongoose.Schema.Types.ObjectId, ref: "CaseForm", default: null },
    // the edition the Case Manager saw when selecting (the CaseForm keeps its own edition / mapping lock afterwards)
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate", default: null },
    editionDate: Date,
    // a form the filing package requires that the Case Manager removed on purpose: acknowledged, so petition validation reports "waived", not "missing"
    waivedRequirement: { type: Boolean, default: false },
    reason: String,
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date, default: Date.now },
    revision: { type: Number, default: 1 }, // the case's formSelectionRevision at the time of the last change
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

// A duplicate selection is impossible: this is the database-level guarantee behind "adding twice is idempotent".
caseFormSelectionSchema.index({ caseId: 1, formCode: 1, componentCode: 1 }, { unique: true });
caseFormSelectionSchema.index({ caseId: 1, decision: 1 });

module.exports = mongoose.models.CaseFormSelection || mongoose.model("CaseFormSelection", caseFormSelectionSchema);
