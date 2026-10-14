// I-824 intake details captured by staff at case creation: the underlying approved petition/application and the requested action. Everything is optional and
// NOTHING is assumed - an I-824 is not always based on an I-130. The module only cleans the input and derives staff-review flags; it never assigns forms
// (the I-130 approval is evidence, and a consular / other-agency route is flagged for review, never turned into a DOS form).
const clean = (value) => String(value ?? "").trim();
const isI824 = (visaType) => clean(visaType).replace(/[^a-z0-9]/gi, "").toUpperCase() === "I824";
const CONSULAR_ROUTE = /consul|embass|nvc|ds-?\s?\d|abroad|port of entry/i;

function buildI824Details(input = {}) {
  const details = {
    formNumber: clean(input.formNumber).toUpperCase(),
    receiptNumber: clean(input.receiptNumber).toUpperCase(),
    approvalDate: clean(input.approvalDate),
    requestedAction: clean(input.requestedAction),
    originalCaseNumber: clean(input.originalCaseNumber),
  };
  const reviewFlags = [];
  if (!details.formNumber) reviewFlags.push("underlying_petition_form_unverified");
  if (!details.receiptNumber) reviewFlags.push("underlying_receipt_number_missing");
  if (!details.approvalDate) reviewFlags.push("underlying_approval_date_missing");
  if (!details.requestedAction) reviewFlags.push("requested_action_unverified");
  if (details.formNumber && details.formNumber !== "I-130") reviewFlags.push("underlying_petition_not_i130_verify_workflow");
  if (CONSULAR_ROUTE.test(details.requestedAction)) reviewFlags.push("consular_or_other_agency_route_staff_review");
  return { ...details, reviewFlags, capturedAt: new Date() };
}

module.exports = { buildI824Details, isI824 };
