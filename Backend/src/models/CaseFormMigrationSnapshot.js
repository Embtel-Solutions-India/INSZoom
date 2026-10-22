// The PRE-IMAGE of one case form taken before an edition migration touches it (plan Rule G). It lives in its own collection, never on the CaseForm (a case form can be
// large) and never populated by a case API: it holds the client's answers, so it is protected like a CaseForm. Restore / read access is a separate, audited, admin-only
// route (assumption: `admin`; no implicit super_admin / team_lead), added later.
//
//   preImage            every persisted answer record (values, provenance, attribution, reviews, overrides) + status / lock / edition pointers, exactly as they were
//   checksum            sha256 over the canonical serialization of preImage: a restore is refused when it no longer matches
//   intermediateImage   the same shape right after the migration's own writes (steps saved / autofilled); with its checksum it tells "only the migration changed this case"
//                       from "a person edited it meanwhile" (safe recovery never overwrites a newer edit)
//   dispositions        what happened to each old record (preserved | archived-with-reason | unresolved), compact, so a verification after a crash needs nothing in memory
//   expiresAt           verified completion + 90 days (initial retention, subject to organizational requirements). NOT set while the migration is unresolved, failed,
//                       waiting for reconciliation or under legalHold, so the TTL index never removes a snapshot that may still be needed.
const mongoose = require("mongoose");

const caseFormMigrationSnapshotSchema = new mongoose.Schema(
  {
    caseFormId: { type: mongoose.Schema.Types.ObjectId, ref: "CaseForm", required: true, index: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    migrationJobId: { type: String, required: true, index: true },
    formCode: { type: String, required: true },
    fromTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate" },
    toTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate" },
    preImage: { type: mongoose.Schema.Types.Mixed, required: true },
    checksum: { type: String, required: true },
    intermediateImage: { type: mongoose.Schema.Types.Mixed, default: null },
    intermediateChecksum: { type: String, default: null },
    dispositions: { type: [mongoose.Schema.Types.Mixed], default: [] },
    state: { type: String, enum: ["active", "released", "purged"], default: "active", index: true },
    legalHold: { type: Boolean, default: false },
    expiresAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  },
  { minimize: false }
);

// a document without expiresAt is never removed by the TTL index (created by scripts/createFormPipelineIndexes-style index scripts; the app runs with autoIndex off)
caseFormMigrationSnapshotSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
caseFormMigrationSnapshotSchema.index({ caseFormId: 1, createdAt: -1 });

module.exports = mongoose.models.CaseFormMigrationSnapshot || mongoose.model("CaseFormMigrationSnapshot", caseFormMigrationSnapshotSchema);
