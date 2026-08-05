const mongoose = require("mongoose");

const aiProviderConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    provider: { type: String, required: true, enum: ["gemini", "openai", "anthropic", "azure_openai", "self_hosted"], index: true },
    displayName: { type: String, required: true },
    enabled: { type: Boolean, default: false, index: true },
    isDefault: { type: Boolean, default: false, index: true },
    endpoint: String,
    model: { type: String, required: true },
    apiKeyEnv: { type: String, required: true },
    apiVersion: String,
    capabilities: {
      chat: { type: Boolean, default: true },
      structuredOutput: { type: Boolean, default: true },
      vision: { type: Boolean, default: false },
      streaming: { type: Boolean, default: false },
      embeddings: { type: Boolean, default: false },
    },
    limits: {
      requestsPerMinute: { type: Number, default: 30, min: 1, max: 10000 },
      maxInputCharacters: { type: Number, default: 120000, min: 1000 },
      maxOutputTokens: { type: Number, default: 4096, min: 128 },
      timeoutMs: { type: Number, default: 60000, min: 1000 },
    },
    pricing: {
      inputPerMillionTokens: { type: Number, default: 0 },
      outputPerMillionTokens: { type: Number, default: 0 },
      currency: { type: String, default: "USD" },
    },
    privacy: {
      sendSensitiveData: { type: Boolean, default: true },
      providerRetention: { type: String, enum: ["provider_default", "zero_retention", "private_deployment"], default: "provider_default" },
      logPromptContent: { type: Boolean, default: false },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

aiProviderConfigSchema.index({ enabled: 1, isDefault: -1 });

module.exports = mongoose.model("AIProviderConfig", aiProviderConfigSchema);
