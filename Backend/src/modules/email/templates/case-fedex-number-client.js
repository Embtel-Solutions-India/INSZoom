// Sent to the client when our team adds the FedEx tracking number AFTER the "case submitted" e-mail already went out (the number was not known yet).
// If the number was on file when the submitted e-mail was sent, it was part of that e-mail and this one is not sent.
const { fedexLines, fedexNumberBox } = require("./fedexSection");
const layout = require("../emailLayoutV2");

function subject(data = {}) {
  return `Your FedEx tracking number${data.caseNumber ? ` (${data.caseNumber})` : ""}`;
}

function bodyLines(data = {}) {
  return [
    `Hi ${data.clientName || "there"},`,
    ...fedexLines(data),
    "Regards,<br>The Immiglance Team",
  ];
}

// The HTML body: the same journey timeline as the submitted e-mail, now with the FedEx step completed and the number in a grey box.
function bodyHtml(data = {}) {
  const steps = [
    { state: "done", title: "Documents received", text: "We have received your documents and information." },
    { state: "done", title: "Case submitted", text: "Your case has been submitted." },
    { state: "done", title: "Shipped by FedEx", text: `Your petition has been shipped. Your FedEx tracking number:${fedexNumberBox(data)}` },
    { state: "pending", title: "USCIS receipt notice", text: "USCIS will send a receipt notice once it has your filing. Processing times vary, and your case manager will tell you as soon as there is any update." },
  ];
  return [
    layout.paragraph(`Hi ${data.clientName || "there"},`),
    layout.paragraph("Your petition has been shipped by FedEx. Here is where your case stands:"),
    layout.timeline(steps),
    layout.button("Track My FedEx Shipment", data.portalLink || "#"),
    layout.paragraph("Sign in to your client portal: on your dashboard there is a FedEx tracking area where you can check the status of your shipment at any time."),
    layout.paragraph("Regards,<br>The Immiglance Team"),
  ].join("");
}

module.exports = { key: "case-fedex-number-client", subject, bodyLines, bodyHtml };
