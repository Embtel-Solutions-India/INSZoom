const mongoose = require("mongoose");

// Public quiz lead — persists regardless of whether the prospect ever books
// (PRD FR-1.5). Distinct from the legacy mailto-only lead flow this model
// replaces the persistence half of (see lead.service.createLead), and from
// the authenticated, case-based eligibility-engine (an unrelated module).
const criteriaAnswerSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    value: { type: Number, min: 0, max: 3, required: true },
    met: { type: Boolean, default: false },
    developable: { type: Boolean, default: false },
  },
  { _id: false }
);

const evidenceStrengthSchema = new mongoose.Schema(
  { key: String, value: Number, label: String },
  { _id: false }
);

const utmSchema = new mongoose.Schema(
  { source: String, medium: String, campaign: String, term: String, content: String },
  { _id: false }
);

const leadSchema = new mongoose.Schema(
  {
    fullName: { type: String, trim: true },
    email: { type: String, lowercase: true, trim: true, index: true },
    phone: { type: String, trim: true },

    visaPathway: { type: String, index: true },
    source: { type: String, default: "" },
    // Free-text details from a contact/consultation form's "Message" field
    // (the quiz path has no equivalent — it has profileAnswers/criteriaAnswers
    // instead). Was previously accepted by createLead() but silently dropped
    // before persistence — see lead.service.js.
    message: { type: String, trim: true },
    utm: { type: utmSchema, default: () => ({}) },

    profileAnswers: { type: mongoose.Schema.Types.Mixed, default: {} },
    criteriaAnswers: { type: [criteriaAnswerSchema], default: [] },

    scoreResult: {
      criteriaMetCount: Number,
      criteriaDevelopableCount: Number,
      tier: { type: String, enum: ["A", "B", "C", "D"] },
      pathwayString: String,
      routing: { type: String, enum: ["direct_priority", "direct", "strategy_queue", "nurture"] },
      evidenceStrength: { type: [evidenceStrengthSchema], default: [] },
      scoringConfigVersion: Number,
      quizDefinitionVersion: Number,
    },

    disclaimerAcceptedVersion: Number,

    consultationId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment", default: null },
    strategyQueueId: { type: mongoose.Schema.Types.ObjectId, ref: "StrategyCallQueueItem", default: null },

    crmSyncStatus: { type: String, enum: ["pending", "synced", "failed", "skipped"], default: "pending", index: true },
    crmSyncedAt: Date,
    crmSyncAttempts: { type: Number, default: 0 },
    crmSyncError: String,

    // PHASE 2: extended enum — existing values (new, contacted, booked,
    // converted, closed) are kept unchanged; the consultation-lifecycle and
    // approval states below are new/additive so existing Lead documents and
    // any code matching on the original values are unaffected.
    status: {
      type: String,
      enum: [
        "new",
        "contacted",
        "booked",
        "converted",
        "closed",
        "consultation_requested",
        "consultation_scheduled",
        "consultation_confirmed",
        "consultation_completed",
        "approved",
        "rejected",
      ],
      default: "new",
      index: true,
    },

    // Admin Leads Inbox — shared-team-inbox semantics: whoever opens it
    // first clears "unseen" for everyone (not a per-admin read receipt),
    // matching how the rest of this app's notification "read" state works.
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    seenAt: { type: Date, default: null, index: true },
    seenBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    notes: [{
      text: { type: String, required: true },
      author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      createdAt: { type: Date, default: Date.now },
    }],

    ipHash: String,
    userAgent: String,

    // ─── PHASE 2 ADDITIONS TO EXISTING LEAD MODEL ────────────────────────────
    // `source` already exists as a plain unrestricted string (no enum), so it
    // already accepts 'intake'/'direct' without a schema change — confirmed
    // during the Pre-Phase 2 intake/lead-flow investigation.

    /**
     * Human-readable lead identifier. Format: L-001, L-002, etc.
     * Generated at creation time using the counters collection.
     */
    leadNumber: {
      type: String,
      unique: true,
      sparse: true,
      default: null,
    },

    /**
     * The visa type the prospect expressed interest in.
     * Separate from Case.visaType — this is unvalidated prospect data.
     */
    visaInterest: {
      type: String,
      default: "",
    },

    /**
     * Whether the prospect is interested in an extension.
     */
    extensionInterest: {
      type: String,
      default: "",
    },

    /**
     * Full consultation lifecycle tracking.
     * Supplements the existing consultationId ref (kept unchanged above).
     */
    consultation: {
      requestedAt: { type: Date, default: null },
      scheduledAt: { type: Date, default: null },
      confirmedAt: { type: Date, default: null },
      completedAt: { type: Date, default: null },
      scheduledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      notes: { type: String, default: "" },
      meetingLink: { type: String, default: "" },
    },

    /**
     * Admin approval tracking — set when admin approves or rejects the lead.
     */
    approval: {
      approvedAt: { type: Date, default: null },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      rejectedAt: { type: Date, default: null },
      rejectionReason: { type: String, default: "" },
    },

    /**
     * The Case that was created from this lead.
     * Set when the admin clicks CREATE CASE from the leads page.
     */
    convertedCaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Case",
      default: null,
    },
    // ─── END PHASE 2 ADDITIONS ────────────────────────────────────────────────
  },
  { timestamps: true }
);

leadSchema.index({ "scoreResult.tier": 1, createdAt: -1 });
leadSchema.index({ "utm.source": 1, "utm.campaign": 1 });
leadSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model("Lead", leadSchema);
