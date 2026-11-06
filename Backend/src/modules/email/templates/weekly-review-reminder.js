const { portalUrl } = require("../portalUrls");

// Sent once every Saturday (5:30 AM IST) to team leads, admins and super admins: please review your case managers for the week. One button: the Admin login.
function subject() {
  return "Review your case managers' week";
}

function bodyLines(data = {}) {
  const login = data.loginLink || `${portalUrl("admin")}/login`;
  return [
    `Hi ${data.name || "there"},`,
    "The week is over. Please take a moment to give feedback on your case managers' performance over the week: a star rating from 1 to 5, with an optional note.",
    "Each case manager sees every review they receive, and their overall performance is the average of all of them.",
    `<a href="${login}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Review Your Case Managers</a>`,
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "weekly-review-reminder", subject, bodyLines };
