// Phase 7.E: what worked. One document per (error signature, strategy): how often the strategy resolved that signature, how often it failed, when it was last used. The
// resolver tries the best non-demoted stored solution for a signature FIRST; a solution that fails twice in a row is demoted (and promoted again by its next success).
// Holds NO client data: a signature is a hash of the stage, the error code and a normalized message.
const mongoose = require("mongoose");

const errorSolutionSchema = new mongoose.Schema(
  {
    signature: { type: String, required: true },
    strategyId: { type: String, required: true },
    stage: String,
    cause: String,
    successes: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    consecutiveFailures: { type: Number, default: 0 },
    demoted: { type: Boolean, default: false },
    lastUsedAt: Date,
    lastSucceededAt: Date,
    lastFormCode: String,
  },
  { timestamps: true }
);

errorSolutionSchema.index({ signature: 1, strategyId: 1 }, { unique: true, name: "one_solution_per_signature_strategy" });
errorSolutionSchema.index({ signature: 1, demoted: 1, successes: -1 });
errorSolutionSchema.index({ stage: 1, successes: -1 });

module.exports = mongoose.models.ErrorSolution || mongoose.model("ErrorSolution", errorSolutionSchema);
