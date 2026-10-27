const mongoose = require("mongoose");

// One message of the feedback thread of a petition: what the client (single person / petitioner / employer) wants changed, and the case manager's answers.
// The thread is between that audience and the case team ONLY - attorneys are not part of it (they have their own staff-only Feedback thread).
const petitionFeedbackMessageSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorName: { type: String, default: "" },
    side: { type: String, enum: ["client", "staff"], required: true }, // which end of the thread wrote it
    body: { type: String, required: true, maxlength: 4000 },
    clientMessageId: { type: String, default: "" }, // lets a retried send be recognised instead of posted twice
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

petitionFeedbackMessageSchema.index({ documentId: 1, createdAt: -1 });
petitionFeedbackMessageSchema.index(
  { documentId: 1, authorId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $gt: "" } } }
);

module.exports = mongoose.model("PetitionFeedbackMessage", petitionFeedbackMessageSchema);
