const mongoose = require("mongoose");

// An invoice the internal team received for a case (per employee case, or a single / family case). Internal only: it is never sent to a client, an employer or an attorney,
// and it is NOT a Document, so it can never appear in the Documents area. The file lives in the shared storage under `invoices/<caseId>/...`.
const caseInvoiceSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    fileName: { type: String, required: true },
    mimeType: { type: String, default: "application/octet-stream" },
    size: { type: Number, default: 0 },
    storageKey: { type: String, required: true },
    note: { type: String, default: "" },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

caseInvoiceSchema.index({ caseId: 1, createdAt: -1 });

module.exports = mongoose.models.CaseInvoice || mongoose.model("CaseInvoice", caseInvoiceSchema);
