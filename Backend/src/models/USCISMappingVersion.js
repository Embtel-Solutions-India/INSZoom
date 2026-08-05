const mongoose = require("mongoose");

const uscisMappingVersionSchema = new mongoose.Schema(
  {
    template: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate", required: true, index: true, immutable: true },
    formCode: { type: String, required: true, index: true, immutable: true },
    formVersion: { type: String, required: true, index: true, immutable: true },
    editionDate: { type: Date, immutable: true },
    mappingVersion: { type: Number, required: true, immutable: true },
    checksum: { type: String, required: true, immutable: true, index: true },
    graph: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    status: { type: String, enum: ["draft", "needs_review", "active", "retired"], default: "draft", index: true },
    validation: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", immutable: true },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    activatedAt: Date,
    retiredAt: Date,
  },
  { timestamps: true },
);

uscisMappingVersionSchema.index({ template: 1, mappingVersion: 1 }, { unique: true });
uscisMappingVersionSchema.index({ formCode: 1, formVersion: 1, status: 1 });

module.exports = mongoose.model("USCISMappingVersion", uscisMappingVersionSchema);
