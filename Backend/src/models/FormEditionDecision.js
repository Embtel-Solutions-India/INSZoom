const mongoose = require("mongoose");
const { DECISIONS, DECISION_STATUSES } = require("../modules/form-edition-policy/editionPolicy.constants");

// Release 0b-1 (plan Rule D): EXACTLY ONE row per { formCode, editionIdentifier }. The row is the organization's current decision about whether
// USCIS accepts THIS edition for filing; every change is also written as an immutable FormEditionAuditEvent. There is NO acceptedEditionDates[]
// array: the gate looks the decision up by the exact edition identifier, and a decision can only cite evidence whose snapshot names that same
// edition, so a decision for one edition can never authorize another.
//
// editionIdentifier is the ISO date (YYYY-MM-DD) of the edition printed on the form (never the `version` string, which on live data is often an
// import date). rejectionDate / graceUntil describe when THIS edition stops being accepted and live on the OLD edition's own row.
//
// NOTE: the unique index below is created by scripts/createFormEditionPolicyIndexes.js (the application runs with autoIndex off, and creating
// indexes is a database change that needs its own approval). Until it exists the service serializes writes per edition and checks for an existing
// row before creating one.
const formEditionDecisionSchema = new mongoose.Schema(
  {
    formCode: { type: String, required: true, trim: true },
    editionIdentifier: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    decision: { type: String, enum: DECISIONS, required: true },
    status: { type: String, enum: DECISION_STATUSES, required: true },
    effectiveDate: { type: Date, default: null },
    rejectionDate: { type: Date, default: null },
    graceUntil: { type: Date, default: null },
    evidenceRefs: [{ _id: false, sourceId: mongoose.Schema.Types.ObjectId, snapshotHash: String, evidenceCaseId: String, recordedAt: Date }],
    decidedBy: { userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, role: String, label: String }, // label "pipeline:official_source" for a machine decision (not enabled)
    decidedAt: { type: Date, required: true },
    reviewBy: { type: Date, default: null },
    holdReason: { type: String, default: "" },
    rationale: { type: String, default: "" },
    quote: { type: String, default: "" },
    version: { type: Number, default: 1 }, // bumped on every change; the audit events carry the version they produced
  },
  { timestamps: true }
);

formEditionDecisionSchema.index({ formCode: 1, editionIdentifier: 1 }, { unique: true });

module.exports = mongoose.models.FormEditionDecision || mongoose.model("FormEditionDecision", formEditionDecisionSchema);
