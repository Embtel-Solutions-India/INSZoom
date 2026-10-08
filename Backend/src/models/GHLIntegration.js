const mongoose = require("mongoose");

// One document per GHL location. Holds the pipelines that make up the unified
// board and the (pipeline id, stage id) -> unified column mapping. Runtime code
// reads this; nothing hard-codes a pipeline or stage id.
const pipelineSchema = new mongoose.Schema(
  {
    ghlPipelineId: { type: String, required: true },
    ghlPipelineName: { type: String, required: true },
    category: { type: String, enum: ["immigrant", "non_immigrant"], required: true },
    enabled: { type: Boolean, default: true },
    lastFetchOkAt: Date,
    lastFetchError: String,
  },
  { _id: false }
);

const stageMappingSchema = new mongoose.Schema(
  {
    ghlPipelineId: { type: String, required: true },
    ghlStageId: { type: String, required: true },
    ghlStageName: { type: String, required: true }, // name as last seen in GHL
    unifiedStageKey: { type: String, required: true },
    unifiedStageName: { type: String, required: true },
  },
  { _id: false }
);

const ghlIntegrationSchema = new mongoose.Schema(
  {
    locationId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["healthy", "config_mismatch", "degraded", "disabled", "unconfigured"],
      default: "unconfigured",
    },
    statusDetail: String,
    pipelines: [pipelineSchema],
    unifiedStages: [
      new mongoose.Schema(
        { key: String, name: String, order: Number },
        { _id: false }
      ),
    ],
    stageMappings: [stageMappingSchema],
    // Set once an admin confirms the mapping; drift detection compares against it.
    mappingsConfirmedAt: Date,
    mappingsConfirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    // Optional, filled in once a visa custom field exists in GHL.
    visaFieldMapping: {
      ghlCustomFieldId: String,
      valueMap: { type: Map, of: String },
    },
    // Phase 1: GHL owns contact basics. Per-field so it can change later.
    contactFieldOwnership: {
      name: { type: String, default: "ghl" },
      email: { type: String, default: "ghl" },
      phone: { type: String, default: "ghl" },
    },
    lastInitialSyncAt: Date,
    lastReconcileAt: Date,
    lastWebhookAt: Date,
    lastApiOkAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("GHLIntegration", ghlIntegrationSchema);
