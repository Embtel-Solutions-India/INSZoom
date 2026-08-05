const mongoose = require("mongoose");

// Append-only audit trail for case ownership changes — deliberately a
// separate collection from Case.assignmentHistory (which stays as-is,
// embedded, capped/archived per case), so compliance/audit queries ("every
// reassignment done by X", "every case Y has ever passed through") don't
// require scanning every Case document's embedded array. Both are written
// together on every reassignment; this collection is never updated or
// deleted after creation.
const caseAssignmentEventSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    // The role slot being reassigned - "case_manager" covers the common
    // case reassignment flow; "team_lead"/"primary_owner"/"secondary_owner"
    // are recorded the same way since they all go through assignUser().
    role: { type: String, enum: ["case_manager", "team_lead", "primary_owner", "secondary_owner"], required: true },
    fromManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    toManagerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reassignedById: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, default: "", trim: true },
    // Reassigning a closed case is allowed (spec explicitly permits it) but
    // is unusual enough to warrant a flag an admin/supervisor can filter on
    // in the assignment-history view, rather than silently blending in with
    // routine in-progress-case reassignments.
    caseStatusAtReassignment: { type: String, default: "" },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

caseAssignmentEventSchema.index({ caseId: 1, createdAt: -1 });
caseAssignmentEventSchema.index({ toManagerId: 1, createdAt: -1 });
caseAssignmentEventSchema.index({ fromManagerId: 1, createdAt: -1 });

caseAssignmentEventSchema.pre("save", function preventMutation(next) {
  if (!this.isNew) {
    const error = new Error("Case assignment events are immutable");
    error.status = 409;
    return next(error);
  }
  return next();
});

module.exports = mongoose.model("CaseAssignmentEvent", caseAssignmentEventSchema);
