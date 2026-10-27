const mongoose = require("mongoose");

// One run of the USCIS news synchronisation (scheduled, manual or retry): what it did, how it ended and which articles failed. Read by the admin status endpoint.
const newsSyncRunSchema = new mongoose.Schema(
  {
    trigger: { type: String, enum: ["schedule", "manual", "startup"], default: "schedule" },
    status: { type: String, enum: ["running", "success", "partial", "failed"], default: "running", index: true },
    startedAt: { type: Date, default: Date.now, index: true },
    finishedAt: { type: Date, default: null },
    feed: {
      url: String,
      httpStatus: Number,
      notModified: { type: Boolean, default: false },
      etag: { type: String, default: "" },
      lastModified: { type: String, default: "" },
      items: { type: Number, default: 0 },
      invalidItems: { type: Number, default: 0 },
      error: { type: String, default: "" },
    },
    counts: {
      created: { type: Number, default: 0 }, // articles imported for the first time
      updated: { type: Number, default: 0 }, // articles whose content changed
      unchanged: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      incomplete: { type: Number, default: 0 },
      newStubs: { type: Number, default: 0 }, // feed entries seen for the first time
    },
    backlog: { type: Number, default: 0 }, // articles still waiting when the run ended
    failures: { type: [{ canonicalUrl: String, message: String, permanent: Boolean, _id: false }], default: [] },
    requestedBy: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("NewsSyncRun", newsSyncRunSchema);
