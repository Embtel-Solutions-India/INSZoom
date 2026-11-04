const mongoose = require("mongoose");
const { SEVERITIES, CATEGORIES, LIMITS } = require("../modules/petition-ai-review/constants");

// One issue the AI found on one page of a petition (Petition AI Review). Kept in its own collection so a 700-page scan with many findings
// never grows a single document; read page by page (index scanId + page).
const petitionAiFindingSchema = new mongoose.Schema(
  {
    scanId: { type: mongoose.Schema.Types.ObjectId, ref: "PetitionAiScan", required: true },
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document", required: true },
    page: { type: Number, required: true, min: 1 }, // absolute page in the petition (computed in code, never taken from the model as-is)
    severity: { type: String, enum: SEVERITIES, required: true },
    category: { type: String, enum: CATEGORIES, required: true },
    excerpt: { type: String, default: "", maxlength: LIMITS.maxExcerptChars }, // the text on the page that has the problem
    found: { type: String, default: "", maxlength: LIMITS.maxTextChars }, // what the page says / what is wrong
    suggestion: { type: String, default: "", maxlength: LIMITS.maxTextChars }, // what it should say / what to do
    section: { type: String, default: "", maxlength: LIMITS.maxSectionChars }, // where on the page, as the page labels it (e.g. "Part 1, Item 2.a")
    confidence: { type: Number, default: 0.5, min: 0, max: 1 },
  },
  { timestamps: true }
);

petitionAiFindingSchema.index({ scanId: 1, page: 1 });
petitionAiFindingSchema.index({ scanId: 1, severity: 1, category: 1 });
petitionAiFindingSchema.index({ caseId: 1 });

module.exports = mongoose.models.PetitionAiFinding || mongoose.model("PetitionAiFinding", petitionAiFindingSchema);
