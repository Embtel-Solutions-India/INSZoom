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

    status: { type: String, enum: ["new", "contacted", "booked", "converted", "closed"], default: "new", index: true },

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
  },
  { timestamps: true }
);

leadSchema.index({ "scoreResult.tier": 1, createdAt: -1 });
leadSchema.index({ "utm.source": 1, "utm.campaign": 1 });
leadSchema.index({ email: 1, createdAt: -1 });

module.exports = mongoose.model("Lead", leadSchema);
