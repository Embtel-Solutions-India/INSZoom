const mongoose = require("mongoose");

const messageTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    key: { type: String, required: true, trim: true, unique: true },
    description: String,
    body: { type: String, required: true },
    subject: String,
    category: { type: String, default: "general", index: true },
    labels: [{ type: String, index: true }],
    visibility: {
      roles: [{ type: String }],
      shared: { type: Boolean, default: true },
    },
    channel: { type: String, enum: ["in_app", "email", "gmail", "outlook", "sms", "whatsapp", "api"], default: "in_app", index: true },
    variables: [{ type: String }],
    usageCount: { type: Number, default: 0 },
    lastUsedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    archivedAt: Date,
  },
  { timestamps: true }
);

messageTemplateSchema.index({ category: 1, archivedAt: 1 });

module.exports = mongoose.model("MessageTemplate", messageTemplateSchema);
