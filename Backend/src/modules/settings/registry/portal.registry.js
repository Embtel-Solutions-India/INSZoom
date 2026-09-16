const { z } = require("zod");

// Settings → Client Portal. New category — the previous passes had no
// direct equivalent. `portal.allowClientDocumentUpload` /
// `portal.allowClientMessages` / `portal.showInvoices` are wired to real
// backend guards (see the completion report for exactly which routes);
// the others are stored/readable but not yet enforced anywhere (honestly
// marked via their `affects` note).
module.exports = [
  { key: "portal.enabled", category: "portal", group: "Access", label: "Enable client portal", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "not yet enforced — no global portal kill-switch middleware built this pass" },
  { key: "portal.twoFactorAuth", category: "portal", group: "Access", label: "Require 2FA for client login", type: "boolean", default: false, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "scaffold — no 2FA module exists yet" },
  { key: "portal.allowClientDocumentUpload", category: "portal", group: "Client capabilities", label: "Clients can upload documents", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "middleware/requirePortalCapability on POST /documents/me — staff uploads are never gated" },
  { key: "portal.allowClientMessages", category: "portal", group: "Client capabilities", label: "Clients can send messages", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "middleware/requirePortalCapability on POST /messages and POST /messages/:threadId — staff messaging is never gated" },
  { key: "portal.autoShareDocuments", category: "portal", group: "Sharing", label: "Auto-share new documents with client", type: "boolean", default: false, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "not yet wired — no document-create hook reads this" },
  { key: "portal.autoShareForms", category: "portal", group: "Sharing", label: "Auto-share new forms with client", type: "boolean", default: false, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "not yet wired — no form-create hook reads this" },
  { key: "portal.showCaseStatus", category: "portal", group: "Visibility", label: "Show case status to client", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "not yet wired — frontend case-detail rendering not built" },
  { key: "portal.showPriorityDates", category: "portal", group: "Visibility", label: "Show USCIS priority dates", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "not yet wired — frontend case-detail rendering not built" },
  { key: "portal.showInvoices", category: "portal", group: "Visibility", label: "Show invoices in client portal", type: "boolean", default: true, validation: z.boolean(), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "middleware/requirePortalCapability on GET /payments — staff/finance reporting is never gated" },
  { key: "portal.welcomeMessage", category: "portal", group: "Content", label: "Custom welcome message", type: "string", default: "", validation: z.string().max(5000), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "client portal dashboard header (frontend not built this pass)" },
  { key: "portal.termsOfUse", category: "portal", group: "Content", label: "Terms of use text", type: "string", default: "", validation: z.string().max(20000), scopes: ["system"], requiresPermission: "settings:manage_portal", affects: "client portal login/registration (frontend not built this pass)" },
];
