const { z } = require("zod");

// Settings → Invoice & Billing. This app models billing as `Payment` /
// `PaymentRequest` (no `Invoice` model exists — confirmed before writing
// this file). These settings are stored/readable now; wiring them into the
// actual payment-creation/reminder flow is not done this pass (would mean
// tracing modules/payments' creation + the existing reminder cron in
// detail, which this pass's time budget didn't allow after the higher-
// priority items above) — see the completion report.
module.exports = [
  { key: "invoice.numberingPrefix", category: "invoice", group: "Numbering", label: "Invoice number prefix", type: "string", default: "INV", validation: z.string().max(20), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired — no Invoice model/creation path exists to attach this to" },
  { key: "invoice.numberingStart", category: "invoice", group: "Numbering", label: "Starting invoice number", type: "number", default: 1001, validation: z.number().int().min(1), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.defaultDueDays", category: "invoice", group: "Terms", label: "Default payment due (days from issue)", type: "number", default: 30, validation: z.number().int().min(0).max(365), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.lateFeeEnabled", category: "invoice", group: "Late fees", label: "Enable automatic late fees", type: "boolean", default: false, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.lateFeeType", category: "invoice", group: "Late fees", label: "Late fee type", type: "enum", enumValues: ["flat", "percent"], default: "percent", validation: z.enum(["flat", "percent"]), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.lateFeeAmount", category: "invoice", group: "Late fees", label: "Late fee amount", type: "number", default: 1.5, validation: z.number().min(0), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.showLogoOnInvoice", category: "invoice", group: "Display", label: "Show firm logo on invoices", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.showAddressOnInvoice", category: "invoice", group: "Display", label: "Show firm address on invoices", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.showTaxIdOnInvoice", category: "invoice", group: "Display", label: "Show tax ID on invoices", type: "boolean", default: false, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.footerNote", category: "invoice", group: "Display", label: "Invoice footer text", type: "string", default: "", validation: z.string().max(2000), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.reminderDays", category: "invoice", group: "Reminders", label: "Reminder schedule (days before/after due)", type: "json", default: [7, 1, -3, -7], validation: z.array(z.number().int()), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired — existing payment reminder cron not traced/updated this pass" },
  { key: "invoice.acceptedPaymentMethods", category: "invoice", group: "Payment methods", label: "Accepted payment types", type: "stringArray", enumValues: ["cash", "check", "bank_transfer", "card"], default: ["cash", "check", "bank_transfer"], validation: z.array(z.string()), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired" },
  { key: "invoice.currency", category: "invoice", group: "Payment methods", label: "Currency", type: "enum", enumValues: ["USD"], default: "USD", validation: z.enum(["USD"]), scopes: ["system"], requiresPermission: "settings:manage_invoice", affects: "not yet wired — this app is USD-only today" },
];
