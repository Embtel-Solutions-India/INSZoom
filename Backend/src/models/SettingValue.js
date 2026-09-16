const mongoose = require("mongoose");

// Settings engine — value storage only. The schema/registry (what keys
// exist, their types/validation/permissions) lives in code under
// modules/settings/registry (see settings.config decision: schema-in-code,
// only values in Mongo). One document per (key, scope, scopeId) tuple;
// SettingsEngineService.getEffective() cascades user -> team ->
// organization -> system -> registry default.
const settingValueSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, index: true },
    scope: { type: String, enum: ["system", "organization", "team", "user"], required: true },
    // null for scope:"system"; an org/team/user ObjectId otherwise. Stored
    // as Mixed (not ObjectId ref) since this repo has no single
    // "Organization" model yet — organization-scope currently means the one
    // implicit firm-wide org, teamId/userId are real refs.
    scopeId: { type: mongoose.Schema.Types.Mixed, default: null },
    value: { type: mongoose.Schema.Types.Mixed },
    version: { type: Number, default: 1 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

settingValueSchema.index({ key: 1, scope: 1, scopeId: 1 }, { unique: true });

module.exports = mongoose.model("SettingValue", settingValueSchema);
