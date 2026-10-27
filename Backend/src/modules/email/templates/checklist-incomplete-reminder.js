const { portalUrl } = require("../portalUrls");

// Sent to a client every 3 days while their checklist has not been SUBMITTED (Save progress does not count - only the Submit button does).
// Professional and direct, a little longer than a one-line notice, and it carries exactly one thing to click: the login button. Never a link into the dashboard:
// the first page is always the login page.
function subject() {
  return "Action required: complete your checklist";
}

function bodyLines(data = {}) {
  const login = data.loginLink || `${portalUrl("client")}/login`;
  return [
    `Hi ${data.clientName || "there"},`,
    "Your checklist has not been submitted yet. Submitting it is the next step before your case manager can begin work on your case.",
    "To continue, sign in to your Immiglance portal, complete any remaining items, and select <strong>Submit</strong>. You can save your progress and return at any time; your case manager can begin only after the checklist has been submitted.",
    `<a href="${login}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Sign In to Complete Checklist</a>`,
    "You will receive this reminder every 3 days until your checklist has been submitted. If you need assistance, you can reach your case manager through the Messages section of your portal.",
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "checklist-incomplete-reminder", subject, bodyLines };
