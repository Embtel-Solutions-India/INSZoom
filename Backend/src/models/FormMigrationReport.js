// Phase 5: what an edition migration left behind, for the governance screens.
//   kind "frozen"   one row per case form that stayed on its old edition because it is finalized / filed / locked (plan Rule G). The newest row per caseFormId wins; a row is
//                   `resolved` once a later migration of the form no longer reports that case form. An UNRESOLVED row never expires.
//   kind "outcome"  one row per migration run of a form: counts and the mapping edges the new edition lost (no field values, no answers).
// Holds case ids and numbers only, never client answers.
const mongoose = require("mongoose");

const formMigrationReportSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ["frozen", "outcome"], required: true },
    formCode: { type: String, required: true, uppercase: true, trim: true },
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate" },
    // frozen rows
    caseFormId: { type: mongoose.Schema.Types.ObjectId, ref: "CaseForm" },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case" },
    caseNumber: String,
    status: String,
    fromEdition: String,
    toEdition: String,
    priority: { type: Boolean, default: false },
    resolved: { type: Boolean, default: false },
    resolvedAt: Date,
    // outcome rows
    counts: { type: mongoose.Schema.Types.Mixed },
    lostEdges: { type: [mongoose.Schema.Types.Mixed], default: undefined },
    reportedAt: { type: Date, default: Date.now },
    expireAt: Date, // outcome rows and RESOLVED frozen rows only
  },
  { versionKey: false, minimize: false }
);

// the app runs with autoIndex off: scripts/createFormGovernanceIndexes.js --apply creates these
formMigrationReportSchema.index({ caseFormId: 1, reportedAt: -1 });
formMigrationReportSchema.index({ kind: 1, reportedAt: -1 });
formMigrationReportSchema.index({ formCode: 1, reportedAt: -1 });
formMigrationReportSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0, sparse: true });

module.exports = mongoose.models.FormMigrationReport || mongoose.model("FormMigrationReport", formMigrationReportSchema);
