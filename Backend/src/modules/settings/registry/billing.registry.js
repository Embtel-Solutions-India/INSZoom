const { z } = require("zod");

// §4.12 Plan & Usage (D2 — read-only informational, no payment processing).
module.exports = [
  {
    key: "billing.seatsLicensed",
    category: "billing",
    group: "Plan & Usage",
    label: "Seats licensed",
    type: "number",
    default: 0,
    validation: z.number().int().min(0),
    scopes: ["system"],
    requiresPermission: "settings:view_billing",
    readOnly: true,
    affects: "informational only",
  },
];
