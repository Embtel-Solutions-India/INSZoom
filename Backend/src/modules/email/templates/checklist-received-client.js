// Sent once to the client when they press Submit and every checklist they have to complete has been submitted.
// Professional confirmation: what was received, what happens next, and that nothing more is needed from the client right now.
function subject() {
  return "Your checklist has been received";
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    "Thank you. Your checklist has been received. Your case manager will now work on your case and will contact you shortly.",
    "No further action is required from you at this time. You can follow the progress of your case at any time by signing in to your Immiglance portal.",
    "Regards,<br>The Immiglance Team",
  ];
}

module.exports = { key: "checklist-received-client", subject, bodyLines };
