const mongoose = require("mongoose");

const aiPromptTemplateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true },
    purpose: { type: String, required: true, index: true },
    version: { type: Number, default: 1, min: 1 },
    status: { type: String, enum: ["draft", "active", "retired"], default: "draft", index: true },
    systemPrompt: { type: String, required: true },
    userPrompt: { type: String, required: true },
    outputSchema: { type: mongoose.Schema.Types.Mixed, default: {} },
    allowedRoles: [String],
    providerKey: String,
    modelSettings: {
      temperature: { type: Number, default: 0.1, min: 0, max: 2 },
      maxOutputTokens: Number,
      responseFormat: { type: String, enum: ["json", "text"], default: "json" },
    },
    changeSummary: String,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

aiPromptTemplateSchema.index({ key: 1, version: 1 }, { unique: true });
aiPromptTemplateSchema.index({ key: 1, status: 1 });

module.exports = mongoose.model("AIPromptTemplate", aiPromptTemplateSchema);
