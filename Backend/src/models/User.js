const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const env = require("../config/env");
const { CANONICAL_ROLES, LEGACY_ROLES, normalizeRole } = require("../modules/authorization/roleHierarchy");

const USER_ROLES = [...new Set([...CANONICAL_ROLES, ...LEGACY_ROLES])];

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: false, minlength: 8, select: false },
    name: { type: String, trim: true },
    displayName: { type: String, trim: true },
    // Optional, chosen (or defaulted to the email prefix) at invite
    // acceptance - see clientInvite.service.js/employeeInvite.service.js's
    // acceptClientInvite/acceptInvite. sparse+unique mirrors referralCode's
    // existing pattern below so accounts with no username never conflict.
    username: { type: String, trim: true, lowercase: true, sparse: true, unique: true, index: true },
    role: { type: String, enum: USER_ROLES, default: "client", index: true },
    // Pre-case, account-level, client-chosen (PlanSelection / a first-run
    // prompt): whether this client is filing for themselves ("individual") or
    // sponsoring one or more employees ("employer"). Distinct from `role` —
    // almost every self-registering client keeps role "client" regardless of
    // this choice; only an invited employee gets role "employee", and that
    // never changes based on applicantType (see employment-workflow
    // controller's isEmployerCapable, which excludes role "employee"
    // outright). This is the server-side gate for employer features — nav
    // visibility is a convenience, not the security boundary.
    applicantType: { type: String, enum: ["individual", "employer"], default: "individual", index: true },
    permissions: { type: [String], default: [] },
    phone: { type: String, trim: true },
    department: { type: String, trim: true },
    specialization: { type: String, trim: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: "Team", default: null },
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: "Company", default: null },
    avatar: String,
    profileImage: String,
    preferences: {
      theme: { type: String, enum: ["light", "dark", "system", ""], default: "" },
      language: { type: String, default: "en" },
      timezone: String,
      notifications: {
        email: { type: Boolean, default: true },
        inApp: { type: Boolean, default: true },
        sms: { type: Boolean, default: false },
      },
    },
    settings: { type: mongoose.Schema.Types.Mixed, default: {} },
    loginHistory: [
      {
        loggedInAt: { type: Date, default: Date.now },
        ipAddress: String,
        userAgent: String,
        success: { type: Boolean, default: true },
      },
    ],
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: Date,
    twoFactorEnabled: { type: Boolean, default: false },
    twoFactorSecret: { type: String, select: false },
    isEmailVerified: { type: Boolean, default: false },
    emailVerificationTokenHash: { type: String, select: false },
    emailVerificationExpiresAt: Date,
    passwordResetTokenHash: { type: String, select: false },
    passwordResetExpiresAt: Date,
    inviteTokenHash: { type: String, select: false },
    inviteTokenExpiresAt: Date,
    lastLogin: Date,
    lastSeenAt: Date,
    isActive: { type: Boolean, default: true, index: true },
    deactivatedAt: Date,
    deactivatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    tokenVersion: { type: Number, default: 0 },
    referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    referredWithCode: { type: String, default: "" },
    referralDiscountAvailable: { type: Boolean, default: false },
    referralDiscountReason: { type: String, enum: ["", "signup", "reward"], default: "" },
    referralRewardCount: { type: Number, default: 0 },
    // Set only by Backend/src/seeds/* on records those seeds actually CREATE.
    // Unrelated to `source`/`legacySource` (sync-origin marker). Consumed only
    // by DELETE /api/admin/demo-data.
    isDemoData: { type: Boolean, default: false, index: true },

    // ─── PHASE 2 ADDITIONS ──────────────────────────────────────────────────
    // Fields added as part of the new case lifecycle architecture.
    // All are optional and have safe defaults. No existing field is modified.

    /** The primary Case this user is associated with (set after case creation) */
    primaryCaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Case",
      default: null,
    },

    /** All Cases this user is associated with */
    caseIds: {
      type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Case" }],
      default: [],
    },

    /** True for existing accounts that had no case when the Phase 3 migration ran */
    legacyNoCaseAccount: {
      type: Boolean,
      default: false,
    },

    /**
     * Migration status set by the Phase 3 account migration script.
     * 'pending' = not yet processed
     * 'linked'  = found and linked to an existing case
     * 'flagged' = no case found, account needs manual review
     */
    migrationStatus: {
      type: String,
      enum: ["pending", "linked", "flagged"],
      default: "pending",
    },

    /**
     * The Lead this user created (set when an intake questionnaire or quiz
     * is submitted and creates a Lead record)
     */
    leadId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Lead",
      default: null,
    },

    /**
     * True when a client account has been created but the client has not yet
     * set their own password (the account was provisioned by staff)
     */
    mustSetPassword: {
      type: Boolean,
      default: false,
    },

    /**
     * The role this user plays within their case structure.
     * Set at account creation time during case provisioning.
     * 'single'       = sole applicant in a single-person visa
     * 'principal'    = employer or petitioner in a multi-person matter
     * 'employee'     = individual employee in an employer/employee visa
     * 'beneficiary'  = beneficiary in a family visa
     */
    caseRole: {
      type: String,
      enum: ["single", "principal", "employee", "beneficiary"],
      default: null,
    },

    /**
     * For employee and beneficiary accounts: the ObjectId of the principal Case
     * (the employer or petitioner case) that this user's case belongs to.
     * Null for single and principal accounts.
     */
    principalCaseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Case",
      default: null,
    },
    // ─── END PHASE 2 ADDITIONS ───────────────────────────────────────────────
  },
  { timestamps: true }
);

userSchema.pre("validate", function (next) {
  if (this.role === "user") this.role = normalizeRole(this.role);
  if (!this.name && this.displayName) this.name = this.displayName;
  if (!this.displayName && this.name) this.displayName = this.name;
  next();
});

userSchema.pre("save", async function (next) {
  if (!this.isModified("password") || !this.password) return next();
  this.password = await bcrypt.hash(this.password, env.bcryptRounds);
  next();
});

userSchema.methods.comparePassword = function (candidatePassword) {
  if (!this.password) return false;
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.isLocked = function () {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
};

userSchema.methods.toAuthJSON = function () {
  return {
    _id: this._id,
    id: this._id,
    email: this.email,
    username: this.username,
    name: this.name || this.displayName,
    displayName: this.displayName || this.name,
    role: this.role,
    applicantType: this.applicantType || "individual",
    permissions: this.permissions || [],
    phone: this.phone,
    department: this.department,
    specialization: this.specialization,
    teamId: this.teamId,
    companyId: this.companyId,
    avatar: this.avatar,
    profileImage: this.profileImage || this.avatar,
    preferences: this.preferences,
    settings: this.settings,
    lastLogin: this.lastLogin,
    isActive: this.isActive,
    isEmailVerified: this.isEmailVerified,
  };
};

userSchema.statics.roles = USER_ROLES;

userSchema.index({ companyId: 1, isActive: 1 });
userSchema.index({ teamId: 1, isActive: 1 });
userSchema.index({ referredBy: 1 });

// PHASE 2 ADDITIONS
userSchema.index({ primaryCaseId: 1 });
userSchema.index({ caseIds: 1 });
userSchema.index({ migrationStatus: 1 });
userSchema.index({ legacyNoCaseAccount: 1 });

module.exports = mongoose.model("User", userSchema);
