const mongoose = require("mongoose");

// A logical, independently-viewable/fillable section of a single official
// USCIS PDF (e.g. I-129's "H Classification Supplement", pages 13-20 of the
// 2026-02-27 edition) - NOT a separate PDF/template of its own. Tied to the
// exact parent template + version it was discovered against
// (USCISFormComponentDiscoveryService), never shared across editions: a new
// USCIS edition gets its own fresh documents here, discovered again from
// that edition's real PDF, rather than inheriting a previous edition's page
// numbers.
//
// componentCode is the stable identity VisaFormMapping references (e.g.
// "I129_H") - it never changes across editions even though `name` (the
// printed heading, which USCIS's own wording can drift on) and pageRanges
// (the actual page numbers) do.
const pageRangeSchema = new mongoose.Schema(
  {
    startPage: { type: Number, required: true },
    endPage: { type: Number, required: true },
  },
  { _id: false }
);

const uscisFormComponentDefinitionSchema = new mongoose.Schema(
  {
    parentFormCode: { type: String, required: true, trim: true, index: true },
    parentTemplateId: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate", required: true, index: true },
    // Denormalized copy of the parent template's own `version` - lets a
    // caller confirm this definition still matches the currently-active
    // parent template without an extra lookup, and is what makes "a new
    // edition never inherits the old page ranges" enforceable/queryable.
    templateVersion: { type: String, required: true, trim: true },
    componentCode: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    componentType: { type: String, enum: ["SUPPLEMENT", "FORM_COMPONENT"], required: true },
    pageRanges: { type: [pageRangeSchema], required: true, validate: (v) => Array.isArray(v) && v.length > 0 },
    // Question.fieldId values (USCISFormTemplate.formFields[].fieldId) that
    // belong to this component - every one of them must have a pageNumber
    // falling inside `pageRanges` (validated at discovery time, not just
    // trusted).
    fieldIds: { type: [String], default: [] },
    status: { type: String, enum: ["ACTIVE", "REVIEW_REQUIRED"], default: "REVIEW_REQUIRED", index: true },
    // Why status is what it is - never silently activated without a reason
    // a human can read.
    reviewReason: { type: String, trim: true },
    discoverySource: { type: String, trim: true, default: "USCISFormComponentDiscoveryService" },
    discoveredAt: { type: Date, default: Date.now },
    verificationMethod: { type: String, trim: true },
    // Adobe-native slice cache (Adobe-native form-slicing task) - the
    // Adobe combinepdf-sliced blank component PDF, cached so the viewer's
    // GET /uscis-forms/:id/component-pdf/:componentCode doesn't call Adobe
    // on every open. All optional/sparse - no migration needed.
    // parentTemplateChecksum guards staleness: if the parent PDF's own
    // checksum (artifacts.form.checksum) changes (a new edition activated
    // under the same template id, or this definition re-pointed at a
    // different parentTemplateId), the cached slice no longer matches the
    // source and must be regenerated.
    slicedPdfStorageKey: { type: String, default: null },
    slicedPdfChecksum: { type: String, default: null },
    slicedPdfCachedAt: { type: Date, default: null },
    parentTemplateChecksum: { type: String, default: null },
  },
  { timestamps: true }
);

// One definition per (parent template version, component) - re-running
// discovery against the same template version upserts in place instead of
// duplicating; a new template version (new parentTemplateId) always gets
// its own fresh documents.
uscisFormComponentDefinitionSchema.index({ parentTemplateId: 1, componentCode: 1 }, { unique: true });
uscisFormComponentDefinitionSchema.index({ parentFormCode: 1, componentCode: 1, status: 1 });

module.exports = mongoose.model("USCISFormComponentDefinition", uscisFormComponentDefinitionSchema);
