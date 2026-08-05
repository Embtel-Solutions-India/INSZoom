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

module.exports = mongoose.model("User", userSchema);
