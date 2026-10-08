const mongoose = require("mongoose");

// External identity of a GHL-linked case: locationId + opportunityId -> case.
//
// This lives in its own collection (instead of a unique index on `cases`)
// because the cases collection is already at MongoDB's 64-index limit, so no
// further index can be built on it. The unique index here is the hard guard
// against creating two cases for one GHL opportunity, even if GHL re-sends an
// event under a different webhook id. It also gives O(1) opportunity -> case
// lookups for the webhook worker.
const ghlCaseLinkSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true },
    opportunityId: { type: String, required: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    contactId: String,
  },
  { timestamps: true }
);

ghlCaseLinkSchema.index({ locationId: 1, opportunityId: 1 }, { unique: true });
ghlCaseLinkSchema.index({ caseId: 1 });
ghlCaseLinkSchema.index({ locationId: 1, contactId: 1 });

module.exports = mongoose.model("GHLCaseLink", ghlCaseLinkSchema);
