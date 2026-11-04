const mongoose = require("mongoose");
const { SCAN_STATUSES, SCAN_STATUS, SEVERITIES } = require("../modules/petition-ai-review/constants");

// One AI scan of one uploaded petition (Document, documentType "petition_manual_upload"). Petition AI Review module.
// The scan is a durable job: claimed by one worker at a time through a lease with a fence number, and it remembers the next page to read
// (`nextPage`), so a server restart resumes exactly where it stopped. A re-scan creates a new record; at most one scan per petition is open.
const diagnosticSchema = new mongoose.Schema(
  {
    from: Number,
    to: Number,
    outcome: String, // OK | EMPTY_RESPONSE | BLOCKED | TRUNCATED | QUOTA | BILLING | TIMEOUT | UPSTREAM | BAD_OUTPUT | ...
    finishReason: String,
    model: String,
    tokens: Number,
    latencyMs: Number,
    note: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const petitionAiScanSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true },
    documentName: { type: String, default: "" },
    trigger: { type: String, enum: ["upload", "manual"], default: "upload" },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: SCAN_STATUSES, default: SCAN_STATUS.QUEUED },
    open: { type: Boolean, default: true }, // true while queued / scanning (partial unique index: one open scan per petition)
    totalPages: { type: Number, default: 0, min: 0 },
    lastPage: { type: Number, default: 0, min: 0 }, // last page that will be scanned (the page cap can make it < totalPages)
    skippedFrom: { type: Number, default: null }, // first page left out by the page cap
    nextPage: { type: Number, default: 1, min: 1 }, // cursor: the first page not yet scanned
    pagesDone: { type: Number, default: 0, min: 0 },
    batchSize: { type: Number, default: 4, min: 1 },
    gaps: { type: [{ from: Number, to: Number, reason: String, _id: false }], default: [] }, // pages that could not be read
    // pages whose AI call failed for a temporary reason (5xx / timeout / bad JSON): reviewed again after the main pass, at most twice
    retryRanges: { type: [{ from: Number, to: Number, tries: { type: Number, default: 0 }, reason: String, _id: false }], default: [] },
    // set while the scan waits for the AI to work again (billing / quota / rejected key): the worker re-checks on its own at nextAttemptAt
    paused: { code: { type: String, default: null }, message: { type: String, default: "" }, since: { type: Date, default: null } },
    usedFallback: { type: Boolean, default: false }, // part of the scan was reviewed by the backup AI (text mode)
    counts: {
      error: { type: Number, default: 0, min: 0 },
      warning: { type: Number, default: 0, min: 0 },
      info: { type: Number, default: 0, min: 0 },
    },
    summary: {
      text: { type: String, default: "" },
      byPage: { type: [{ page: Number, count: Number, worst: { type: String, enum: SEVERITIES }, _id: false }], default: [] },
      byCategory: { type: Map, of: Number, default: {} },
      // The bullet summary: one point per page in page order, each issue on that page a sub-point (built in code from the findings)
      points: {
        type: [{
          page: Number,
          items: { type: [{ section: String, severity: { type: String, enum: SEVERITIES }, category: String, text: String, _id: false }], default: [] },
          _id: false,
        }],
        default: [],
      },
      more: { type: Number, default: 0 }, // issues not written into the points (very large scans); they are in the findings list
      builtAt: Date,
    },
    diagnostics: { type: [diagnosticSchema], default: [] },
    rulesVersion: { type: Number, default: 0 },
    modelUsed: { type: String, default: "" },
    // Token use, split the way Google bills it (input / output / thinking; thinking is billed as output), and the exact model version
    // that answered (the configured name can be an alias such as gemini-flash-latest). Phase 6.
    usage: {
      calls: { type: Number, default: 0 },
      tokens: { type: Number, default: 0 },
      input: { type: Number, default: 0 },
      output: { type: Number, default: 0 },
      thinking: { type: Number, default: 0 },
    },
    modelVersion: { type: String, default: "" },
    error: { code: String, message: String, at: Date },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5, min: 1 },
    nextAttemptAt: { type: Date, default: null },
    lease: {
      token: { type: String, default: null },
      fence: { type: Number, default: 0 },
      lockedUntil: { type: Date, default: null },
      workerId: { type: String, default: null },
    },
    startedAt: Date,
    finishedAt: Date,
  },
  { timestamps: true }
);

petitionAiScanSchema.index({ documentId: 1, createdAt: -1 });
petitionAiScanSchema.index({ caseId: 1, createdAt: -1 });
petitionAiScanSchema.index({ open: 1, status: 1, nextAttemptAt: 1 });
petitionAiScanSchema.index({ documentId: 1 }, { unique: true, partialFilterExpression: { open: true }, name: "one_open_scan_per_petition" });

module.exports = mongoose.models.PetitionAiScan || mongoose.model("PetitionAiScan", petitionAiScanSchema);
