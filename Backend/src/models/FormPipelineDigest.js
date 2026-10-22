// Run-level state of the developer e-mail digest (plan "Developer email notifications": scheduled / catalog-wide runs send ONE digest of the successes instead of one e-mail per
// form). One OPEN document per key ("success:<trigger>") collects the entries and counts the individual e-mails already sent in this window (the per-run cap); the flusher closes
// it after a quiet period, claiming it atomically (open -> sending -> sent) so two processes can never send the same digest twice. Holds form codes and edition dates only.
// The app runs with autoIndex off: the unique partial index below is created by scripts/createFormPipelineIndexes.js --apply; until then a race can leave two open
// documents for a key, which the flusher simply sends as two digests.
const mongoose = require("mongoose");

const entrySchema = new mongoose.Schema(
  { formCode: String, fromEdition: String, toEdition: String, release: String, jobId: String, trigger: String, at: { type: Date, default: Date.now } },
  { _id: false }
);

const formPipelineDigestSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    state: { type: String, enum: ["open", "sending", "sent"], default: "open" },
    entries: { type: [entrySchema], default: [] },
    count: { type: Number, default: 0 },
    individualSent: { type: Number, default: 0 },
    firstEntryAt: { type: Date, default: Date.now },
    lastEntryAt: { type: Date, default: Date.now },
    sentAt: Date,
    // finished digests are removed by the database after 30 days
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

formPipelineDigestSchema.index({ key: 1 }, { unique: true, partialFilterExpression: { state: "open" }, name: "one_open_digest_per_key" });
formPipelineDigestSchema.index({ state: 1, lastEntryAt: 1 });
formPipelineDigestSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.models.FormPipelineDigest || mongoose.model("FormPipelineDigest", formPipelineDigestSchema);
