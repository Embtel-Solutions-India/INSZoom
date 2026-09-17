const mongoose = require("mongoose");

// Attorney <-> Case Manager dialogue on a specific case. Deliberately a new,
// dedicated model rather than reusing Case.internalNotes/externalNotes
// (see Attorney/PHASE0_FINDINGS.md §3) — those are a general staff
// notes log with no author-role/threading/unread-state concept; this is a
// two-party structured thread with reply-threading and per-recipient
// unread tracking, driving in-app + push notifications.
const feedbackSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    authorRole: { type: String, required: true },
    // NOT required at the schema level — a message can be attachment-only
    // (empty string). "must have text or an attachment" is a business rule
    // enforced in feedback.service.js's createFeedback, not a schema
    // constraint (a schema-level required: true rejects "" and broke every
    // file-only send with a 500 — caught by a real Playwright upload test).
    message: { type: String, default: "", trim: true },
    parentFeedbackId: { type: mongoose.Schema.Types.ObjectId, ref: "Feedback", default: null, index: true },
    // Same shape as message.service.js's storeAttachments() output — this
    // module stores its own copy of that ~15-line mapping over
    // storage.service.js rather than importing message.service.js's
    // unexported internal helper.
    attachments: [
      {
        originalName: String,
        fileUrl: String,
        fileSize: Number,
        mimeType: String,
        storageProvider: String,
        storageKey: String,
        checksum: String,
      },
    ],
    readBy: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        readAt: { type: Date, default: Date.now },
      },
    ],
    deletedAt: Date,
  },
  { timestamps: true }
);

feedbackSchema.index({ caseId: 1, createdAt: 1 });

module.exports = mongoose.model("Feedback", feedbackSchema);
