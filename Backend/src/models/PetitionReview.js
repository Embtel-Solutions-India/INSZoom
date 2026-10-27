const mongoose = require("mongoose");

// Who may see one uploaded petition (Document, documentType "petition_manual_upload") and when it was released to them. One record per petition document.
//   - a petition uploaded AFTER this feature has a record from the moment it is uploaded, with nothing released: only the case team sees it
//   - attorneyReview.sentAt  -> the attorneys with access to the case see it (Attorney Portal) and are e-mailed
//   - clientReview.sentAt    -> the case's petition audience (single person / petitioner / employer - see petitionAudience.js) sees it (Client Portal) and is e-mailed
//   - a petition uploaded BEFORE this feature has no record: it stays visible to attorneys exactly as it was, and is not shown to any client
const releaseSchema = new mongoose.Schema(
  {
    sentAt: { type: Date, default: null },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    note: { type: String, default: "", maxlength: 2000 },
    count: { type: Number, default: 0 }, // how many times it was (re)sent
  },
  { _id: false }
);

const petitionReviewSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true, unique: true },
    attorneyReview: { type: releaseSchema, default: () => ({}) },
    clientReview: { type: releaseSchema, default: () => ({}) },
    // set the moment the case team was e-mailed about the FIRST client feedback on this petition (later messages are not e-mailed)
    clientFeedbackNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

petitionReviewSchema.index({ caseId: 1, "clientReview.sentAt": 1 });

module.exports = mongoose.model("PetitionReview", petitionReviewSchema);
