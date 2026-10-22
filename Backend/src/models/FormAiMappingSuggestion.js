// Phase 4: one Gemini mapping SUGGESTION for one box of one form edition. Suggestions are evidence for a person (shadow mode) or, for the narrow auto_use tier and only
// when the accuracy gate is open, input to a NEW mapping version (mode "on"); a stored suggestion never changes a mapping graph by itself. Rows are immutable
// (written with $setOnInsert and read back as the cache): the same edition + box + inputs + prompt + model is never asked twice.
// Holds form metadata only - no client answer, document or case data can be in it (the prompt input is an allow-list, see form-ai-mapping/promptInput.js).
const mongoose = require("mongoose");

const formAiMappingSuggestionSchema = new mongoose.Schema(
  {
    templateId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate", required: true },
    formCode: { type: String, required: true, index: true },
    editionDate: Date,
    targetFieldId: { type: String, required: true },
    targetPdfField: String,
    inputHash: { type: String, required: true }, // hash(edition checksum, box metadata, registry version, questionnaire schema version, prompt version, model)
    candidate: { type: mongoose.Schema.Types.Mixed, default: null }, // { path, type, role } - always a path of the live registry, or null when nothing fits
    reasonCode: String,
    labelEvidence: String,
    rawScore: Number, // the model's own number: kept for audit, NEVER used to decide anything
    tier: { type: String, enum: ["auto_use", "needs_review", "rejected"], required: true, index: true },
    checks: { type: mongoose.Schema.Types.Mixed, default: {} }, // each independent code check: { name: { ok, detail } }
    reasons: { type: [String], default: [] }, // why it is not auto_use / why it was rejected
    risks: { type: [String], default: [] }, // address_block, checkbox, radio, dropdown, repeating, conditional, ssn_or_anumber, other_party
    corroboration: { type: mongoose.Schema.Types.Mixed, default: null }, // { source, path, transform, condition } of the sibling form / golden fixture that lifted a risky box
    corroboratedBy: { type: String, default: null }, // "sibling_form" | "golden_fixture" when a risky box was corroborated
    existingEdge: { type: mongoose.Schema.Types.Mixed, default: null }, // what the box maps to today, if anything: { sourcePath, origin, agrees }
    registryVersion: String,
    questionnaireSchemaVersion: String,
    model: String,
    promptVersion: Number,
    mode: { type: String, enum: ["shadow", "on"], default: "shadow" },
    appliedAt: Date, // set when mode "on" wrote it into a new mapping version
    appliedMappingVersion: Number,
    createdAt: { type: Date, default: Date.now },
  },
  { minimize: false }
);

// the app runs with autoIndex off: scripts/createFormAiMappingIndexes.js (or the first write on a fresh database) creates these
formAiMappingSuggestionSchema.index({ templateId: 1, targetFieldId: 1, inputHash: 1 }, { unique: true });
formAiMappingSuggestionSchema.index({ formCode: 1, tier: 1, createdAt: -1 });

module.exports = mongoose.models.FormAiMappingSuggestion || mongoose.model("FormAiMappingSuggestion", formAiMappingSuggestionSchema);
