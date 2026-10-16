// The reviewer's final sign-off on the golden set (plan Phase 2). Append-only: it records who, when, and a checksum of the exact entries that were reviewed, so a later
// change to the draft makes an old sign-off visibly out of date instead of silently reusing it.
const mongoose = require("mongoose");

const goldenSetSignOffSchema = new mongoose.Schema(
  {
    reviewerEmail: { type: String, required: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    signedAt: { type: Date, default: Date.now, index: true },
    entriesChecksum: { type: String, required: true },
    counts: { total: Number, right: Number, wrong: Number },
    verifiedByKind: { type: Map, of: Number },
    verifiedByForm: { type: Map, of: Number },
    statement: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.GoldenSetSignOff || mongoose.model("GoldenSetSignOff", goldenSetSignOffSchema);
