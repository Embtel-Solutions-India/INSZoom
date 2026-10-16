// A durable record of one run of the form import pipeline for ONE form (plan Phase 1). It survives restarts, is claimed by exactly one worker at a time through a
// lease with a fence number, and says which stage it is in, why it failed, what was tried and when it will be tried again.
//
// A form has at most one OPEN job (pending | running | blocked | held): a second request for the same form returns that job instead of starting another run.
// dead_letter and done jobs are closed; done jobs expire after FORM_PIPELINE done retention (TTL on `expireAt`).
const mongoose = require("mongoose");
const { JOB_STATES, OPEN_STATES, TRIGGERS, SCHEMA_VERSION, LIMITS } = require("../modules/form-pipeline/pipeline.constants");

const stageSchema = new mongoose.Schema(
  {
    status: { type: String, enum: ["running", "done", "failed", "skipped"], default: "running" },
    attempts: { type: Number, default: 0 },
    startedAt: Date,
    finishedAt: Date,
    error: { class: String, code: String, message: String },
  },
  { _id: false }
);

const formPipelineJobSchema = new mongoose.Schema(
  {
    formCode: { type: String, required: true, uppercase: true, trim: true },
    trigger: { type: String, enum: TRIGGERS, default: "unknown" },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    options: { forceCheck: { type: Boolean, default: false } },
    schemaVersion: { type: Number, default: SCHEMA_VERSION, index: true },
    state: { type: String, enum: Object.values(JOB_STATES), default: JOB_STATES.PENDING },
    open: { type: Boolean, default: true }, // true while state is one of OPEN_STATES (kept as a field so a PARTIAL unique index can enforce "one open job per form")
    shadow: { type: Boolean, default: false },

    // identity of the edition being worked on, known after the detect stage: `${formCode}|${editionDate}|${checksum}`
    editionKey: String,
    currentStage: String,
    stages: { type: Map, of: stageSchema, default: {} },

    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: LIMITS.maxAttempts },
    nextAttemptAt: Date,

    // exactly one worker holds the lease; every write by that worker is conditional on token AND fence, so a worker that lost the lease cannot change anything
    lease: {
      lockedUntil: Date,
      token: String,
      fence: { type: Number, default: 0 },
      workerId: String,
    },

    lastError: { class: String, code: String, stage: String, message: String, at: Date },
    repairsTried: [{ _id: false, strategy: String, outcome: String, verification: String, at: Date }],
    artifacts: {
      previousTemplateId: mongoose.Schema.Types.ObjectId,
      newTemplateId: mongoose.Schema.Types.ObjectId,
      checksum: String,
      storageKey: String,
    },
    outcome: { type: mongoose.Schema.Types.Mixed }, // small summary of how a finished run ended
    // alert dedupe: one entry per distinct (state|stage|error signature) already announced for this job
    alerts: [{ _id: false, signature: String, kind: String, at: Date }],
    history: [{ _id: false, at: Date, state: String, stage: String, note: String }],

    startedAt: Date,
    completedAt: Date,
    expireAt: Date, // set when the job is done; a TTL index removes it afterwards
  },
  { timestamps: true }
);

formPipelineJobSchema.pre("validate", function setOpen(next) {
  this.open = OPEN_STATES.includes(this.state);
  next();
});

// at most one OPEN job per form (partial unique index)
formPipelineJobSchema.index({ formCode: 1 }, { unique: true, partialFilterExpression: { open: true }, name: "one_open_job_per_form" });
// cheap claim query: the worker polls state + nextAttemptAt
formPipelineJobSchema.index({ state: 1, nextAttemptAt: 1 });
formPipelineJobSchema.index({ state: 1, "lease.lockedUntil": 1 });
formPipelineJobSchema.index({ formCode: 1, editionKey: 1 });
formPipelineJobSchema.index({ createdAt: -1 });
formPipelineJobSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0, sparse: true });

module.exports = mongoose.model("FormPipelineJob", formPipelineJobSchema);
