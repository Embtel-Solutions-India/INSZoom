const mongoose = require("mongoose");

// §5.2.2 Settings → Users & Permissions → Teams ("Case Manager Teams").
// No Team model existed anywhere in this codebase before this pass
// (confirmed) — this is new, and purely organizational in this pass (used
// for display/grouping in the Settings UI); it does not yet gate case
// assignment or notification routing.
const teamSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Team", teamSchema);
