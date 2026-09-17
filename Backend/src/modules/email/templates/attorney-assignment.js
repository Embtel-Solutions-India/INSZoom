function subject(data = {}) {
  return `New Case Assigned to You — ${data.caseNumber || ""}`;
}

function bodyLines(data = {}) {
  return [
    `Hello ${data.attorneyName || "there"},`,
    `You have been assigned to a new immigration case.`,
    `<strong>Case:</strong> ${data.caseNumber || ""}<br/><strong>Case Type:</strong> ${data.visaType || "—"}<br/><strong>Client:</strong> ${data.clientName || "—"}`,
    `Log in to the Attorney Portal to review the case details, documents, forms, and communicate with the Case Manager through the Feedback section.`,
    `<a href="${data.attorneyPortalUrl || "#"}/login" style="display:inline-block;padding:12px 24px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Open the Attorney Portal</a>`,
    `This link was sent because you were assigned by ${data.assignedByName || "a case manager"}.`,
  ];
}

module.exports = { key: "attorney-assignment", subject, bodyLines };
