// Sent to a prospect when staff declines to move forward after their
// consultation. Kept deliberately brief and free of a specific reason —
// data.rejectionReason is stored on the Lead for internal reference only.
function subject(data = {}) {
  return `Update on your consultation`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.fullName || "there"},`,
    `Thank you for taking the time to speak with ${data.msoEntityShortName || "our team"}. After reviewing your consultation, we won't be able to move forward with your case at this time.`,
    `We wish you the best in your immigration journey.`,
  ].filter(Boolean);
}

module.exports = { key: "lead-rejected", subject, bodyLines };
