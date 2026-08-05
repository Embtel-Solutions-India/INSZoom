// Sent to the prospect immediately after they complete the public
// eligibility quiz — confirms receipt and previews their result.
function subject(data = {}) {
  return `Your ${data.visaPathway || "immigration"} eligibility results`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.fullName || "there"},`,
    `Thanks for completing the ${data.visaPathway || "immigration"} eligibility quiz. Here's what we found:`,
    `<strong>${data.pathwayString || "We've reviewed your answers."}</strong>`,
    data.nextStep || "Our team will follow up with next steps shortly.",
    `${data.msoEntityShortName || "Our team"} is not a law firm and does not provide legal advice.`,
  ];
}

module.exports = { key: "quiz-lead-confirmation", subject, bodyLines };
