const mongoose = require("mongoose");
const { appendOnly } = require("./helpers/appendOnly");

// Release 0b-1 (plan Rule D): IMMUTABLE evidence snapshots. One row is the text the SYSTEM itself fetched from an official uscis.gov source at one
// moment. A snapshot is never edited or deleted; several decision rows may cite the same snapshot, each owning its own conclusion. The snapshot
// hash identifies the fetched evidence only - it is never compared with a PDF checksum (those are separate identifiers).
const redirectHopSchema = new mongoose.Schema({ url: String, status: Number, location: String }, { _id: false });

const formEditionSourceSchema = new mongoose.Schema(
  {
    sourceUrl: { type: String, required: true },
    finalUrl: { type: String, required: true },
    redirectChain: { type: [redirectHopSchema], default: [] },
    httpStatus: { type: Number, required: true },
    contentType: { type: String, default: null },
    fetchedAt: { type: Date, required: true },
    snapshotHash: { type: String, required: true, index: true }, // sha256 of extractedText
    extractedText: { type: String, required: true },
    textLength: { type: Number, required: true },
    fetchedBy: { userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, role: String },
    evidenceCaseId: { type: String, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

appendOnly(formEditionSourceSchema, "FormEditionSource");

module.exports = mongoose.models.FormEditionSource || mongoose.model("FormEditionSource", formEditionSourceSchema);
