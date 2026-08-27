const mongoose = require("mongoose");

// PHASE 2 — `graph` below is Mixed (a plain object, no Mongoose sub-schema),
// so `profileOwner`/`allowsOccurrenceOverride` cannot be added as enforced
// schema fields on graph.edges[] without a migration, which is outside this
// phase's scope (see Backend/src/models/Case.js's Phase 2 additions comment
// for the same additive-only constraint). `graph`'s type is left unchanged.
//
// REFERENCE: expected shape of each edge object within graph.edges[].
// Documentation only — not enforced by Mongoose, since `graph` is Mixed.
// Seeding scripts (Backend/src/modules/form-mapping/seeds/*.js) must follow
// this shape exactly; the three existing mapping seeds (i129-h1b, i129f-k1,
// i130-k3) already populate profileOwner/allowsOccurrenceOverride on every
// edge they produce, classified from each edge's sourcePath.
//
// {
//   mappingId: String (unique stable ID for this edge),
//   formCode: String,
//   editionDate: String,
//   version: String,
//   sourcePath: String (canonical path like "employer.legalName" or "employee.firstName"),
//   sourceType: String,
//   targetFieldId: String,
//   targetPdfField: String (exact AcroForm field name),
//   targetLabel: String,
//   targetType: String,
//   section: String,
//   pageNumber: Number,
//   mappingType: String,
//   confidence: Number,
//   status: String,
//   transform: Object,
//   condition: Object,
//   note: String,
//   profileOwner: 'employer' | 'employee' | 'case' | null,
//   allowsOccurrenceOverride: Boolean (default false),
// }
const EDGE_SCHEMA_REFERENCE = Object.freeze({
  mappingId: "String (unique stable ID for this edge)",
  formCode: "String",
  editionDate: "String",
  version: "String",
  sourcePath: "String (canonical path, e.g. 'company.name' or 'raw.questionnaireAnswers.employee_*')",
  sourceType: "String",
  targetFieldId: "String",
  targetPdfField: "String (exact AcroForm field name)",
  targetLabel: "String",
  targetType: "String",
  section: "String",
  pageNumber: "Number",
  mappingType: "String",
  confidence: "Number",
  status: "String",
  transform: "Object",
  condition: "Object",
  note: "String",
  /**
   * profileOwner: which canonical data store this edge reads from and writes to.
   *
   * 'employer'  = read from EmployerProfile.canonicalData[fieldKey]
   *               An edit to this field propagates to ALL child case forms
   *               because EmployerProfile is shared across the matter.
   *
   * 'employee'  = read from EmployeeProfile.canonicalData[fieldKey] for this
   *               specific case only. An edit affects ONLY this case's forms.
   *
   * 'case'      = read directly from Case[fieldKey] (e.g. visaType, extension)
   *               Not a profile field — comes from the Case document itself.
   *
   * This field is SET AT SEEDING TIME ONLY and is READ-ONLY at runtime.
   * The sync engine and AutoFillService use this to route reads and writes.
   * It must NEVER be written by application logic based on runtime conditions.
   *
   * Default is null (unclassified). Unclassified edges are treated as 'employee'
   * by the sync engine until explicitly classified.
   */
  profileOwner: "'employer' | 'employee' | 'case' | null",
  /**
   * allowsOccurrenceOverride: whether a case manager edit to one occurrence
   * of this field propagates to ALL occurrences (false) or is stored as an
   * override for that specific occurrence only (true).
   *
   * FALSE (default): editing any occurrence updates canonical AND re-renders all occurrences.
   * TRUE: reserved for fields where USCIS genuinely requires different values per occurrence.
   *
   * SET AT SEEDING TIME ONLY. Read-only at runtime.
   */
  allowsOccurrenceOverride: "Boolean (default false)",
});

const uscisMappingVersionSchema = new mongoose.Schema(
  {
    template: { type: mongoose.Schema.Types.ObjectId, ref: "USCISFormTemplate", required: true, index: true, immutable: true },
    formCode: { type: String, required: true, index: true, immutable: true },
    formVersion: { type: String, required: true, index: true, immutable: true },
    editionDate: { type: Date, immutable: true },
    mappingVersion: { type: Number, required: true, immutable: true },
    checksum: { type: String, required: true, immutable: true, index: true },
    graph: { type: mongoose.Schema.Types.Mixed, required: true, immutable: true },
    status: { type: String, enum: ["draft", "needs_review", "active", "retired"], default: "draft", index: true },
    validation: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", immutable: true },
    activatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    activatedAt: Date,
    retiredAt: Date,
  },
  { timestamps: true },
);

uscisMappingVersionSchema.index({ template: 1, mappingVersion: 1 }, { unique: true });
uscisMappingVersionSchema.index({ formCode: 1, formVersion: 1, status: 1 });

const USCISMappingVersion = mongoose.model("USCISMappingVersion", uscisMappingVersionSchema);

// PHASE 2 — attached as a static (not a change to the module's export
// shape, which every existing caller uses directly as the Mongoose model,
// e.g. `const USCISMappingVersion = require(".../USCISMappingVersion")`)
// so the edge-shape documentation is importable without breaking any
// existing `require(...)` call site.
USCISMappingVersion.EDGE_SCHEMA_REFERENCE = EDGE_SCHEMA_REFERENCE;

module.exports = USCISMappingVersion;
