module.exports = {
  subject: ({ caseNumber }) => `Client intake submitted for ${caseNumber || "a case"}`,
  bodyLines: ({ caseManagerName, clientName, caseNumber, completionPercentage }) => [
    `Hi ${caseManagerName || "Case Manager"},`,
    `${clientName || "A client"} submitted their intake information for case ${caseNumber || ""}.`,
    `Current intake completion is ${completionPercentage || 0}%. Please review the client profile, questionnaire responses, uploaded documents, and missing document list in INSZoom.`,
  ],
};
