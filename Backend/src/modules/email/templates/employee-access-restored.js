// Sent to an employee when their employer GIVES THEM ACCESS AGAIN to the information on their own case: the employer had taken the file back
// (to fill part of it in themselves) and has now handed it back. Everything the employee entered earlier is kept and the employer's entries
// are visible to them. An employee who never finished setting up their account gets the same password-setup link as a first invitation.
const env = require("../../../config/env");

const FRONTEND_URL = env.clientUrl;

function subject(data = {}) {
  return `${data.employerName || "Your employer"} has given you access to your case information again`;
}

function bodyLines(data = {}) {
  const needsSetup = Boolean(data.needsSetup && data.token);
  const link = needsSetup ? `${FRONTEND_URL}/accept-invite?token=${data.token}` : `${FRONTEND_URL}/dashboard/documents`;
  const lines = [
    `Hi ${data.employeeName || "there"},`,
    `${data.employerName || "Your employer"} has given you access to your information for immigration case ${data.caseNumber || ""} again.`,
    `They have already filled in part of it for you. Everything you entered earlier is kept, and what your employer added is now visible to you - please review it, correct anything that is wrong and complete the rest.`,
    `<strong>Your Case ID:</strong> ${data.caseNumber || ""}`,
  ];
  if (needsSetup) {
    lines.push(`You have not set your password yet. Click below to set it and open your case:`);
    lines.push(`<a href="${link}" style="display:inline-block;padding:10px 20px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Set Your Password &amp; Open Your Case</a>`);
    lines.push(`Or copy this link into your browser: ${link}`);
    lines.push(`This link expires in 7 days.`);
  } else {
    lines.push(`<a href="${link}" style="display:inline-block;padding:10px 20px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Review &amp; Complete Your Information</a>`);
    lines.push(`Or copy this link into your browser: ${link}`);
  }
  return lines;
}

module.exports = { key: "employee-access-restored", subject, bodyLines };
