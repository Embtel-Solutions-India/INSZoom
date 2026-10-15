const mongoose = require("mongoose");
const { appendOnly } = require("./helpers/appendOnly");
const { AUDIT_EVENT_TYPES } = require("../modules/form-edition-policy/editionPolicy.constants");

// Release 0b-1 (plan Rule D, decision 20): the PERMANENT, append-only audit trail of an edition decision. NO TTL (retention is set later by
// organizational requirements). The existing AuditLog (2-year TTL) only holds a secondary copy.
//
// One evidence case = the six events EVIDENCE_SUBMITTED, SOURCE_FETCHED, VERIFICATION_COMPLETED, DECISION_RECORDED, GATE_RECALCULATED,
// OUTCOME_RECORDED, linked by evidenceCaseId. `seq` orders them inside a case. The payload is the event's own facts (quote, snapshot hash,
// per-check results, gate result, ...).
const formEditionAuditEventSchema = new mongoose.Schema(
  {
    evidenceCaseId: { type: String, required: true, index: true },
    seq: { type: Number, required: true },
    type: { type: String, enum: AUDIT_EVENT_TYPES, required: true, index: true },
    formCode: { type: String, required: true, index: true },
    editionIdentifier: { type: String, required: true },
    actor: { userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, role: String, label: String },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    at: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

formEditionAuditEventSchema.index({ evidenceCaseId: 1, seq: 1 }, { unique: true });
formEditionAuditEventSchema.index({ formCode: 1, editionIdentifier: 1, at: -1 });

appendOnly(formEditionAuditEventSchema, "FormEditionAuditEvent");

module.exports = mongoose.models.FormEditionAuditEvent || mongoose.model("FormEditionAuditEvent", formEditionAuditEventSchema);
