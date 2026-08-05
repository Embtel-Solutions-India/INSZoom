const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: "global", unique: true, index: true },
    companyName: { type: String, default: "BAIS" },
    companyLogo: { type: String, default: "" },
    // Firm letterhead for generated legal documents (petition cover
    // letters, etc.) — additive, blank by default so existing installs are
    // unaffected until an admin fills them in.
    firmAddress: { type: String, default: "" },
    firmPhone: { type: String, default: "" },
    timezone: { type: String, default: "America/New_York" },
    dateFormat: { type: String, default: "MM/DD/YYYY" },
    defaultLanguage: { type: String, default: "en" },
    assignmentStrategy: { type: String, enum: ["manual", "round_robin", "least_loaded"], default: "manual" },
    autoAssignAttorneys: { type: Boolean, default: false },
    slaIntakeMaxDays: { type: Number, default: 7 },
    slaAttorneyReviewMaxDays: { type: Number, default: 14 },
    clientPortalUrl: { type: String, default: "" },
    clientPortalApiKey: { type: String, default: "", select: false },
    autoSyncEnabled: { type: Boolean, default: false },
    syncInterval: { type: Number, default: 3600 },
    emailEnabled: { type: Boolean, default: true },
    smtpHost: { type: String, default: "" },
    smtpPort: { type: Number, default: 587 },
    smtpUser: { type: String, default: "" },
    smtpPassword: { type: String, default: "", select: false },
    emailFrom: { type: String, default: "" },
    notificationEnabled: { type: Boolean, default: true },
    notifyOnNewCase: { type: Boolean, default: true },
    notifyOnPayment: { type: Boolean, default: true },
    notifyOnPaymentOverdue: { type: Boolean, default: true },
    notifyOnRfeReceived: { type: Boolean, default: true },
    notifyOnDocumentUpload: { type: Boolean, default: true },
    notifyOnEODReport: { type: Boolean, default: true },
    sessionTimeout: { type: Number, default: 3600 },
    maxLoginAttempts: { type: Number, default: 5 },
    jwtExpiry: { type: String, default: "4d" },
    requireTwoFactor: { type: Boolean, default: false },
    passwordMinLength: { type: Number, default: 8 },
    passwordRequireUppercase: { type: Boolean, default: true },
    passwordRequireLowercase: { type: Boolean, default: true },
    passwordRequireNumbers: { type: Boolean, default: true },
    passwordRequireSpecialChars: { type: Boolean, default: true },
    primaryColor: { type: String, default: "#10b981" },
    defaultDashboardPeriod: { type: String, enum: ["today", "this_week", "this_month", "this_year"], default: "this_month" },
    showRevenueChart: { type: Boolean, default: true },
    showCasesByStageChart: { type: Boolean, default: true },
    showLeaderboardSummary: { type: Boolean, default: true },
    eodReportRequired: { type: Boolean, default: true },
    eodReportAutoReminder: { type: Boolean, default: true },
    eodReportReminderTime: { type: String, default: "17:00" },
    auditLogEnabled: { type: Boolean, default: true },
    auditLogRetentionDays: { type: Number, default: 90 },
    customFields: { type: Map, of: mongoose.Schema.Types.Mixed, default: new Map() },
    integrations: { type: mongoose.Schema.Types.Mixed, default: {} },

    // --- Phase 0: organizational entities (MSO / attorney-supervised firm
    // structure) — additive, defaults keep every existing install identical
    // until an admin fills these in. lawFirmEntityName stays blank ("") until
    // founder-confirmed; never guess a law firm name into existence. ---
    msoEntityName: { type: String, default: "Bay Area Immigration Services" },
    msoEntityShortName: { type: String, default: "BAIS" },
    lawFirmEntityName: { type: String, default: "" },
    lawFirmEntityShortName: { type: String, default: "" },
    lawFirmIsConfigured: { type: Boolean, default: false },

    // --- Phase 0: brand identity / theming tokens (feeds future white-label) ---
    activeBrand: { type: String, default: "BAIS" },
    brandTokens: {
      primaryColor: { type: String, default: "#0B1F3A" },
      accentColor: { type: String, default: "#C6A15B" },
      logoUrl: { type: String, default: "" },
    },

    // --- Phase 0: legal / compliance copy (DB is the source of truth; blank
    // means "use the hardcoded fallback in compliance.constants.js" — see
    // entityConfig.service.resolveDisclaimer/resolveProhibitedTerms). ---
    nonAttorneyDisclaimer: { type: String, default: "" },
    disclaimerVersion: { type: Number, default: 1 },
    prohibitedTerms: { type: [String], default: [] },

    // --- Phase 1: public quiz / lead-gen funnel config — all additive,
    // safe defaults so the funnel degrades gracefully with nothing
    // configured (see Section 12 of the Phase 1 spec: these are
    // founder-provided values the code cannot invent). ---
    // Staff notification recipient for new quiz leads. Falls back to the
    // legacy hardcoded address in lead.service.js when blank.
    leadNotificationEmail: { type: String, default: "" },
    // CRM webhook sync — sync is skipped cleanly (never fails the lead)
    // until both are configured.
    crmWebhookUrl: { type: String, default: "" },
    crmApiKey: { type: String, default: "", select: false },
    // GA4 measurement id, consumed by the frontend only — backend never
    // calls GA directly.
    gaMeasurementId: { type: String, default: "" },
    // Consultant routing roster: which consultant/calendar handles which
    // visa pathway + language, and daily capacity caps. Empty array means
    // "no roster configured" — routing.service falls back to one default
    // queue and flags the response accordingly.
    consultationRouting: {
      type: [{
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        visaPathways: { type: [String], default: [] },
        languages: { type: [String], default: ["English"] },
        dailyCapacityCap: { type: Number, default: 8 },
      }],
      default: [],
      _id: false,
    },

    // Free consultation booking (the "book me" flow reached from the public
    // quiz results page) — a single native host calendar, deliberately
    // separate from consultationRouting above (which is the tier-gated
    // roster used by the internal strategy-queue). Every prospect can book
    // here regardless of tier; hostUserId unset falls back to the first
    // Super Admin found and flags hostConfigured:false in admin responses
    // only (never in public ones — the host's identity is never public).
    consultation: {
      hostUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      publicHostName: { type: String, default: "Our Immigration Team" },
      durationMinutes: { type: Number, default: 30 },
      bufferMinutes: { type: Number, default: 15 },
      locationType: { type: String, enum: ["video", "phone"], default: "video" },
      meetingLink: { type: String, default: "" },
      timezone: { type: String, default: "America/Los_Angeles" },
      minNoticeHours: { type: Number, default: 12 },
      bookingWindowDays: { type: Number, default: 21 },
      dailyCap: { type: Number, default: 0 },
    },

    lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    lastUpdatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

settingsSchema.pre("save", function updateTimestamp(next) {
  this.lastUpdatedAt = new Date();
  next();
});

module.exports = mongoose.model("Settings", settingsSchema);
