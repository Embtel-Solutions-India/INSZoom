const mongoose = require("mongoose");

// The assembled artifact + its state, one document per assembly version.
// Additive/non-destructive: a re-assemble creates a NEW PetitionPackage
// version (this collection), never mutates Case/Answer/checklist data, and
// never deletes a prior version — it's superseded, not removed. Status/
// versioning/lock shape mirrors CaseForm's own established pattern
// (status enum, versionNumber, isLocked/lockedAt/lockedBy, embedded
// history[]) rather than inventing a new house style.

const sectionSchema = new mongoose.Schema(
  {
    // position_description_letter/itinerary added for the H-1B petition's
    // drafted-skeleton letters (Phase H5's petition-structure spec) - the
    // same front_matter treatment as support_letter/personal_statement.
    type: { type: String, enum: ["cover_letter", "g28", "form", "certification", "support_letter", "position_description_letter", "itinerary", "personal_statement", "exhibit"], required: true },
    key: { type: String, required: true },
    title: { type: String, required: true },
    exhibitLabel: String,
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    caseFormId: { type: mongoose.Schema.Types.ObjectId, ref: "CaseForm" },
    pageStart: Number,
    pageEnd: Number,
    order: { type: Number, default: 0 },
    // Editable HTML for letter-type sections only (cover_letter,
    // support_letter, personal_statement) — for the cover letter this is
    // the PROSE ONLY, with the derived exhibit-index table split out (see
    // PetitionAssemblyService's bodyHtml split), so the frontend editor
    // never touches the always-current, always-derived table. Unset for
    // form/certification/exhibit sections — those are read-only, rendered
    // straight from documentId's PDF.
    contentHtml: String,
  },
  { _id: false }
);

const exhibitIndexEntrySchema = new mongoose.Schema(
  {
    // Stable identifier across reorders (exhibitTaxonomy/letterSlot key) —
    // `label` (A/B/C) changes on every reorder, so it can't identify a
    // bucket across requests; `key` is what the reorder-order array is
    // keyed on.
    key: String,
    label: { type: String, required: true },
    title: { type: String, required: true },
    description: String,
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    // Every approved document bucketed into this exhibit — the frontend
    // viewer renders each one's pages after the "Exhibit A — Title" divider
    // sheet (see ExhibitService.build's `exhibits[].documentIds`, which this
    // mirrors). documentId above stays for a single-document exhibit's
    // mailing-PDF page-range bookkeeping; this is the full set.
    documentIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document" }],
    pageStart: Number,
    pageEnd: Number,
  },
  { _id: false }
);

const validationIssueSchema = new mongoose.Schema(
  {
    severity: { type: String, enum: ["error", "warning"], required: true },
    code: { type: String, required: true },
    message: { type: String, required: true },
    sectionKey: String,
    formCode: String,
  },
  { _id: false }
);

const historyEntrySchema = new mongoose.Schema(
  {
    versionNumber: Number,
    status: String,
    action: { type: String, required: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    at: { type: Date, default: Date.now },
    changeSummary: String,
    validationSnapshot: mongoose.Schema.Types.Mixed,
  },
  { _id: true }
);

const petitionPackageSchema = new mongoose.Schema(
  {
    caseId: { type: mongoose.Schema.Types.ObjectId, ref: "Case", required: true, index: true },
    packageDefinitionKey: { type: String, required: true },
    packageDefinitionVersion: { type: Number, required: true },
    status: {
      type: String,
      enum: ["draft", "assembling", "assembled", "needs_revision", "finalized", "filed", "superseded", "failed"],
      default: "draft",
      index: true,
    },
    versionNumber: { type: Number, default: 1 },
    isCurrent: { type: Boolean, default: true },
    sections: [sectionSchema],
    exhibitIndex: [exhibitIndexEntrySchema],
    // User-saved custom exhibit order (bucket keys) — applied by
    // ExhibitService.build's `order` param on every rebuild of THIS
    // version (finalize), so a drag-and-drop reorder survives finalize.
    // A fresh assemble() intentionally does not carry this over from a
    // prior version; each new assembled version starts at default order.
    exhibitOrder: [String],
    outputs: {
      presentationWordDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
      mailingPdfDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
      coverLetterDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
    },
    validation: {
      status: { type: String, enum: ["passed", "blocked", "warnings"], default: "passed" },
      issues: [validationIssueSchema],
      validatedAt: Date,
    },
    filing: {
      method: { type: String, enum: ["usps", "fedex", "ups", "dhl", "online"] },
      addressUsed: String,
      shippedAt: Date,
      trackingNumber: String,
      receiptNumber: String,
      filedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    lock: {
      locked: { type: Boolean, default: false },
      lockedAt: Date,
      lockedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      reason: String,
    },
    history: [historyEntrySchema],
    assembledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

petitionPackageSchema.index({ caseId: 1, packageDefinitionKey: 1, isCurrent: 1 });
petitionPackageSchema.index({ caseId: 1, versionNumber: -1 });

module.exports = mongoose.model("PetitionPackage", petitionPackageSchema);
