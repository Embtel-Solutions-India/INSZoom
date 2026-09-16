const { z } = require("zod");

// §4.6 Integrations & API — settings-level toggles only in this pass.
// NOTE: the full API-key/webhook CRUD (ApiKey model with hashed secrets,
// webhook delivery with HMAC signing + retry log) is a separate, larger
// feature not yet built — see the run's status report. These two flags are
// real switches a future ApiKey/Webhook dispatcher will read, wired now so
// the settings UI surface exists and nothing here is a dead cosmetic field
// once that dispatcher ships.
module.exports = [
  {
    key: "integrations.apiKeys.enabled",
    category: "integrations",
    group: "API access",
    label: "Allow API key authentication",
    type: "boolean",
    default: false,
    validation: z.boolean(),
    scopes: ["system"],
    requiresPermission: "settings:manage_integrations",
    affects: "planned: ApiKey auth middleware",
  },
  {
    key: "integrations.webhooks.enabled",
    category: "integrations",
    group: "Webhooks",
    label: "Allow outbound webhooks",
    type: "boolean",
    default: false,
    validation: z.boolean(),
    scopes: ["system"],
    requiresPermission: "settings:manage_integrations",
    affects: "planned: webhook dispatcher",
  },
];
