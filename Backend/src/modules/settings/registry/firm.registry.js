const { z } = require("zod");

// Settings → Firm Profile. Replaces the old organization.registry.js +
// branding.registry.js (neither had any real runtime consumer to preserve —
// confirmed before deleting them). firm.primaryColor/logo are read by the
// (not-yet-built) frontend theme injection and by CoverLetterService.js's
// PDF letterhead once that's wired — see the completion report's "not done"
// list for the honest status of that wiring.
module.exports = [
  { key: "firm.name", category: "firm", group: "Identity", label: "Firm name", type: "string", default: "Immiglance", validation: z.string().min(1).max(200), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "PDF letterhead, email from-name, client portal header" },
  { key: "firm.displayName", category: "firm", group: "Identity", label: "Display name (short)", type: "string", default: "Immiglance", validation: z.string().min(1).max(80), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "in-app header, browser tab title" },
  { key: "firm.logo", category: "firm", group: "Identity", label: "Logo (S3 key)", type: "string", default: "", validation: z.string().max(2000), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "Admin header, client portal header, invoice header, PDF letterhead" },
  { key: "firm.address.line1", category: "firm", group: "Office address", label: "Address line 1", type: "string", default: "", validation: z.string().max(200), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "PDF letterhead, invoice header" },
  { key: "firm.address.line2", category: "firm", group: "Office address", label: "Address line 2", type: "string", default: "", validation: z.string().max(200), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "PDF letterhead, invoice header" },
  { key: "firm.address.city", category: "firm", group: "Office address", label: "City", type: "string", default: "", validation: z.string().max(100), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "PDF letterhead, invoice header" },
  { key: "firm.address.state", category: "firm", group: "Office address", label: "State", type: "string", default: "", validation: z.string().max(100), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "PDF letterhead, invoice header" },
  { key: "firm.address.zip", category: "firm", group: "Office address", label: "ZIP", type: "string", default: "", validation: z.string().max(20), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "PDF letterhead, invoice header" },
  { key: "firm.phone", category: "firm", group: "Contact", label: "Main phone", type: "string", default: "", validation: z.string().max(50), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "PDF letterhead, invoice header" },
  { key: "firm.email", category: "firm", group: "Contact", label: "Main contact email", type: "string", default: "", validation: z.union([z.literal(""), z.string().email()]), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "reply-to on system emails" },
  { key: "firm.website", category: "firm", group: "Contact", label: "Website URL", type: "string", default: "", validation: z.string().max(300), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "client portal footer" },
  { key: "firm.taxId", category: "firm", group: "Contact", label: "Tax / EIN", type: "string", default: "", validation: z.string().max(50), scopes: ["system"], requiresPermission: "settings:manage_firm", sensitive: true, affects: "invoice footer (optional)" },
  { key: "firm.timezone", category: "firm", group: "Locale", label: "Time zone", type: "string", default: "America/New_York", validation: z.string().min(1), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "SLA due-dates, date display, cron scheduling" },
  { key: "firm.dateFormat", category: "firm", group: "Locale", label: "Date display format", type: "enum", enumValues: ["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"], default: "MM/DD/YYYY", validation: z.enum(["MM/DD/YYYY", "DD/MM/YYYY", "YYYY-MM-DD"]), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "date rendering util" },
  { key: "firm.workingDays", category: "firm", group: "Locale", label: "Working days", type: "stringArray", enumValues: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], default: ["mon", "tue", "wed", "thu", "fri"], validation: z.array(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "future SLA business-day calc (not yet consumed — SLA math is calendar-day only, see workflow.registry.js)" },
  { key: "firm.primaryColor", category: "firm", group: "Brand", label: "Brand color", type: "color", default: "#10b981", validation: z.string().regex(/^#(?:[0-9a-fA-F]{3}){1,2}$/), scopes: ["system"], requiresPermission: "settings:manage_firm", affects: "Admin/client-portal theme CSS variable, invoice accent (frontend wiring not built this pass)" },
];
