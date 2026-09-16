const mongoose = require("mongoose");

// §5.7 Settings → Invoice & Billing "Saved Charges" — reusable line items
// an admin pre-defines so staff don't retype the same amount/description
// every time they add a charge to a payment/invoice.
const savedChargeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, default: "" },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "USD" },
    category: { type: String, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SavedCharge", savedChargeSchema);
