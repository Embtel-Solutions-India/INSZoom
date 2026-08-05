const mongoose = require("mongoose");

// Admin-owned, versioned config: "what does a filing-ready petition for this
// visa look like" — required forms/certifications/letter slots/exhibit
// taxonomy, plus the two ordering profiles (presentation vs. mailing). Data,
// not code — adding a new visa is a new document here, never an engine
// change. Intentionally separate from document-requirement.resolver.js
// (which drives the client-facing intake checklist off live
// Questionnaire/Question docs) — different consumer, different concern.

const requiredFormSchema = new mongoose.Schema(
  {
    formCode: { type: String, required: true, trim: true },
    required: { type: Boolean, default: true },
    supplements: [{ type: String, trim: true }],
  },
  { _id: false }
);

const requiredCertificationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true },
    documentType: { type: String, required: true, trim: true },
    required: { type: Boolean, default: true },
  },
  { _id: false }
);

const letterSlotSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true },
    // front_matter: sits with the argument letters right after forms/certs.
    // exhibit: evidence — flows through ExhibitService, never front matter.
    placement: { type: String, enum: ["front_matter", "exhibit"], required: true },
    templateKey: { type: String, trim: true },
    required: { type: Boolean, default: false },
  },
  { _id: false }
);

const exhibitTaxonomyEntrySchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    label: { type: String, required: true },
    documentTypes: [{ type: String, trim: true }],
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { _id: false }
);

// Letter/cover-letter template bodies, versioned together with the rest of
// the definition. No separate top-level template collection exists (or is
// needed) today — templates are conceptually part of "how this visa's
// petition is assembled," so they live here and are edited via the same
// PUT /petition/definitions/:key endpoint as everything else.
const templateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true },
    kind: { type: String, enum: ["cover_letter", "letter"], required: true },
    format: { type: String, enum: ["html"], default: "html" },
    content: { type: String, required: true },
  },
  { _id: false }
);

const orderingSchema = new mongoose.Schema(
  {
    presentation: [{ type: String, trim: true }],
    mailing: [{ type: String, trim: true }],
  },
  { _id: false }
);

const packageDefinitionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, index: true },
    visaType: { type: String, required: true, trim: true },
    // Alias visa-type strings this same definition also applies to (e.g.
    // I-130 covers both "IR-1" and "CR-1") — mirrors the visaType/visaTypes
    // pairing already used by real Questionnaire documents in this codebase.
    visaTypes: [{ type: String, trim: true }],
    filingSubtype: { type: String, trim: true, default: "" },
    displayName: { type: String, required: true },
    status: { type: String, enum: ["active", "draft", "archived"], default: "draft", index: true },
    version: { type: Number, default: 1 },
    requiredForms: [requiredFormSchema],
    requiredCertifications: [requiredCertificationSchema],
    letterSlots: [letterSlotSchema],
    exhibitTaxonomy: [exhibitTaxonomyEntrySchema],
    templates: [templateSchema],
    coverLetterTemplateKey: { type: String, trim: true },
    filingAddressKey: { type: String, trim: true },
    ordering: { type: orderingSchema, default: () => ({ presentation: [], mailing: [] }) },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

packageDefinitionSchema.index({ visaType: 1, filingSubtype: 1, status: 1 });

module.exports = mongoose.model("PackageDefinition", packageDefinitionSchema);
