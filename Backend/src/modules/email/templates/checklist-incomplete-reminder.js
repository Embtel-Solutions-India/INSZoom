const { portalUrl } = require("../portalUrls");
const layout = require("../emailLayoutV2");

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

// The HTML body: the same message with the client's progress drawn as the vertical timeline (done / you are here / still to come),
// so it is clear where they are and that submitting is the step that unlocks the rest. Plain-text and admin-customised versions keep bodyLines.
function bodyHtml(data = {}) {
  const login = data.loginLink || `${portalUrl("client")}/login`;
  const steps = [
    { state: "done", title: "Case created", text: "Your case is set up and your checklist has been shared with you in your Immiglance portal." },
    { state: "current", title: "Document filling", text: "You are here. Complete any remaining items, then select <strong>Submit</strong>. You can save your progress and return at any time." },
    { state: "pending", title: "Documents submitted", text: "Once you submit, your case manager receives everything and begins work on your case." },
  ];
  return [
    layout.paragraph(`Hi ${data.clientName || "there"},`),
    layout.paragraph("Your checklist has not been submitted yet. Here is where your case stands and what comes next:"),
    layout.timeline(steps),
    `<a href="${login}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Sign In to Complete Checklist</a>`,
    layout.paragraph("<br>You will receive this reminder every 3 days until your checklist has been submitted. If you need assistance, you can reach your case manager through the Messages section of your portal."),
    layout.paragraph("Regards,<br>The Immiglance Team"),
  ].join("");
}

module.exports = { key: "checklist-incomplete-reminder", subject, bodyLines, bodyHtml };
