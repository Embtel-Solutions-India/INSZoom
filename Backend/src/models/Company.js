const mongoose = require("mongoose");

const addressSchema = new mongoose.Schema(
  {
    label: String,
    street: String,
    addressLine1: String,
    addressLine2: String,
    city: String,
    state: String,
    zip: String,
    zipCode: String,
    country: { type: String, default: "USA" },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: true }
);

const contactSchema = new mongoose.Schema(
  {
    name: String,
    title: String,
    role: String,
    email: { type: String, lowercase: true, trim: true },
    phone: String,
    isPrimary: { type: Boolean, default: false },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: true }
);

const officeSchema = new mongoose.Schema(
  {
    name: String,
    type: { type: String, enum: ["headquarters", "branch", "office", "remote", "other"], default: "office" },
    address: addressSchema,
    phone: String,
    email: { type: String, lowercase: true, trim: true },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const programSchema = new mongoose.Schema(
  {
    name: String,
    visaType: String,
    description: String,
    status: { type: String, enum: ["active", "inactive", "paused"], default: "active" },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: true }
);

const noteSchema = new mongoose.Schema(
  {
    note: { type: String, required: true },
    isInternal: { type: Boolean, default: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
    updatedAt: Date,
  },
  { _id: true }
);

const timelineSchema = new mongoose.Schema(
  {
    type: { type: String, default: "activity", index: true },
    title: { type: String, required: true },
    description: String,
    metadata: mongoose.Schema.Types.Mixed,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const auditSchema = new mongoose.Schema(
  {
    action: { type: String, required: true },
    changes: mongoose.Schema.Types.Mixed,
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    performedAt: { type: Date, default: Date.now },
    ipAddress: String,
    userAgent: String,
  },
  { _id: true }
);

const companySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, index: true },
    legalName: { type: String, trim: true },
    dbaName: { type: String, trim: true },
    ein: { type: String, trim: true, index: true },
    registrationNumber: String,
    industry: String,
    numberOfEmployees: Number,
    website: String,
    description: String,

    status: { type: String, enum: ["active", "inactive", "prospect", "on_hold", "archived"], default: "active", index: true },
    isActive: { type: Boolean, default: true, index: true },

    address: addressSchema,
    businessAddress: addressSchema,
    mailingAddress: addressSchema,
    addresses: [addressSchema],
    officeLocations: [officeSchema],
    branchOffices: [officeSchema],

    contact: {
      phone: String,
      email: { type: String, lowercase: true, trim: true },
      website: String,
    },
    authorizedSignatory: contactSchema,
    hrContact: contactSchema,
    contacts: [contactSchema],

    hrManager: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    hrUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    beneficiaries: [{ type: mongoose.Schema.Types.ObjectId, ref: "Beneficiary", index: true }],

    immigrationPrograms: [programSchema],
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    companyDocuments: [
      {
        document: { type: mongoose.Schema.Types.ObjectId, ref: "Document" },
        documentType: String,
        name: String,
        status: { type: String, enum: ["requested", "uploaded", "approved", "rejected", "needs_update"], default: "requested" },
        uploadedAt: Date,
      },
    ],
    billing: {
      billingEmail: { type: String, lowercase: true, trim: true },
      billingContact: String,
      paymentTerms: String,
      taxExempt: { type: Boolean, default: false },
      defaultCurrency: { type: String, default: "usd" },
    },

    source: { type: String, enum: ["INSZoom", "BAIS", "shared", "import", ""], default: "shared" },
    notes: [noteSchema],
    timeline: [timelineSchema],
    activityHistory: [timelineSchema],
    auditHistory: [auditSchema],
    // Set only by Backend/src/seeds/* on records those seeds actually CREATE.
    // Unrelated to `source` (sync-origin marker). Consumed only by
    // DELETE /api/admin/demo-data.
    isDemoData: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

companySchema.pre("validate", function syncCompatibilityFields(next) {
  if (this.status === "archived") this.isActive = false;
  if (this.isActive === false && this.status === "active") this.status = "inactive";
  if (!this.address && this.addresses?.length) this.address = this.addresses.find((item) => item.isPrimary) || this.addresses[0];
  if (this.address && !this.addresses?.length) {
    const primaryAddress = typeof this.address.toObject === "function" ? this.address.toObject() : this.address;
    this.addresses = [{ ...primaryAddress, isPrimary: true }];
  }
  if (this.contact?.website && !this.website) this.website = this.contact.website;
  if (this.website && !this.contact?.website) this.contact = { ...(this.contact || {}), website: this.website };
  if (this.hrManager && !this.hrUsers?.some((id) => id?.toString() === this.hrManager.toString())) {
    this.hrUsers = [...(this.hrUsers || []), this.hrManager];
  }
  next();
});

companySchema.index({ name: "text", legalName: "text", ein: "text", "contact.email": "text" });
companySchema.index({ status: 1, updatedAt: -1 });
companySchema.index({ hrManager: 1, status: 1 });

module.exports = mongoose.model("Company", companySchema);
