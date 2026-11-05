const { portalUrl } = require("../portalUrls");

// Sent to a case manager when someone reviews their performance for the week.
function subject() {
  return "You received feedback on your performance";
}

function bodyLines(data = {}) {
  const login = data.loginLink || `${portalUrl("admin")}/login`;
  return [
    `Hi ${data.name || "there"},`,
    `${data.reviewerRole || "A reviewer"} has given you feedback on your performance this week${data.rating ? ` (${data.rating}/5)` : ""}.`,
    "Sign in to see the review and your overall performance.",
    `<a href="${login}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">View My Performance</a>`,
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "performance-review-received", subject, bodyLines };
