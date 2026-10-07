module.exports = {
  key: "questionnaire-progress-saved",
  subject: ({ caseNumber, filledBy }) => `${filledBy || "A client"} saved progress on case ${caseNumber || ""}`.trim(),
  bodyLines: ({ caseManagerName, recipientName, clientName, filledBy, caseNumber, visaType, employerName, checklistName, completionPercentage, portalLink }) => [
    `Hi ${caseManagerName || recipientName || "Case Manager"},`,
    `<strong>${clientName || "A client"}</strong>${filledBy ? ` (${filledBy})` : ""} has filled in information on the questionnaire${checklistName ? ` <strong>${checklistName}</strong>` : ""} for case <strong>${caseNumber || ""}</strong>${visaType ? ` (${visaType})` : ""}${employerName ? ` - ${employerName}` : ""}.`,
    completionPercentage || completionPercentage === 0 ? `Current completion: ${completionPercentage}%.` : null,
    "Please review what was entered in the Admin portal.",
    `<a href="${portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">Review in Admin</a>`,
  ].filter(Boolean),
};
