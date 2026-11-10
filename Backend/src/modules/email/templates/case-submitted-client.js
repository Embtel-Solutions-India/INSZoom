// Sent to the client once, the moment their case card reaches the "Submitted" stage on the Pipeline (moved by the team, through Update Stage, or in GoHighLevel).
// Warm and short: congratulations, where the case stands, what comes next, one button.
function subject(data = {}) {
  return `Congratulations - your case has been submitted${data.caseNumber ? ` (${data.caseNumber})` : ""}`;
}

const { fedexLines, fedexNumberBox, trackingUrl } = require("./fedexSection");
const layout = require("../emailLayoutV2");

// When the FedEx tracking number is already on file (data.trackingNumber) the e-mail carries it; without one the FedEx part is left out entirely and the
// number follows in its own e-mail once the team adds it.
function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    "Congratulations! Your case has been submitted. This is a big step, and it would not have been possible without your timely documents and information.",
    "USCIS will send a receipt notice once it has your filing. Processing times vary, and your case manager will tell you as soon as there is any update.",
    ...fedexLines(data),
    `<a href="${data.portalLink || "#"}" style="display:inline-block;padding:12px 24px;background:#1e3a5f;color:#ffffff;border-radius:8px;text-decoration:none;font-weight:bold;">Track My Case</a>`,
    "Regards,<br>The Immiglance Team",
  ];
}

// The HTML body: the case's journey as the vertical timeline (documents received -> case submitted -> shipped by FedEx -> USCIS receipt). With the FedEx number on file the
// FedEx step is done and carries the number; without one it is a step still to come, and the number follows in its own e-mail. Plain-text and admin-customised
// versions keep bodyLines.
function bodyHtml(data = {}) {
  const hasNumber = Boolean(trackingUrl(data.trackingNumber));
  const portal = data.portalLink || "#";
  const steps = [
    { state: "done", title: "Documents received", text: "We have received your documents and information." },
    { state: hasNumber ? "done" : "current", title: "Case submitted", text: hasNumber ? "Your case has been submitted." : "You are here. Your case has been submitted." },
    hasNumber
      ? { state: "done", title: "Shipped by FedEx", text: `Your petition has been shipped. Your FedEx tracking number:${fedexNumberBox(data)}` }
      : { state: "pending", title: "Shipped by FedEx", text: "Your petition is sent to USCIS by FedEx. We will e-mail you your FedEx tracking number as soon as it is available." },
    { state: "pending", title: "USCIS receipt notice", text: "USCIS will send a receipt notice once it has your filing. Processing times vary, and your case manager will tell you as soon as there is any update." },
  ];
  return [
    layout.paragraph(`Hi ${data.clientName || "there"},`),
    layout.paragraph("Congratulations! Your case has been submitted. This is a big step, and it would not have been possible without your timely documents and information. Here is where your case stands:"),
    layout.timeline(steps),
    layout.button(hasNumber ? "Track My FedEx Shipment" : "Track My Case", portal),
    ...(hasNumber ? [layout.paragraph("Sign in to your client portal: on your dashboard there is a FedEx tracking area where you can check the status of your shipment at any time.")] : []),
    layout.paragraph("Regards,<br>The Immiglance Team"),
  ].join("");
}

module.exports = { key: "case-submitted-client", subject, bodyLines, bodyHtml };
