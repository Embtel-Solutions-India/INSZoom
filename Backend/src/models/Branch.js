const mongoose = require("mongoose");

// §5.2.3 Settings → Users & Permissions → Branches. Display/organizational
// only in this pass (assigned to a user via User.branch, added below) — not
// yet a case-assignment or access-control boundary.
const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, default: "" },
    phone: { type: String, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Branch", branchSchema);
