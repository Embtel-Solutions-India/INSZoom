// Form G-28 (Notice of Entry of Appearance as Attorney or Accredited Representative) crosswalk: CANONICAL PROFILE -> G-28 PDF fields.
//
// DRAFT FOR REVIEW: authored for approval, saved as a mapping version that is NOT activated (see seeds/g28-mapping.seed.js). A reviewer approves it in
// the form-governance screen.
//
// WHAT IS MAPPED: Part 3 (Client's Contact Information, Items 5-13) and the repeated client name on the continuation page - the facts the platform
// already holds as canonical person.* / contact.* / case.* values. Every fieldName below was read from the G-28 template (edition imported
// 2026-09-22); the template's own item numbers in its labels run one ahead of the printed form in places, so the Part 3 item numbers here follow
// the PDF field names (Pt3Line5 = client name, Pt3Line8 = USCIS account, Pt3Line9 = A-Number, Line9-Line12 = phone / mobile / e-mail / address).
//
// WHAT IS DELIBERATELY NOT MAPPED (left to the case manager, with the reason):
//   - Part 1 (attorney / representative identity, address, bar number, licensing authority, firm): the platform has no canonical source for the
//     representative; it is never inferred from the case's client data.
//   - Part 2 (eligibility - attorney in good standing / accredited representative / associated with / law student): a legal declaration.
//   - Part 3 Item 1-3 (USCIS / ICE / CBP appearance and the matter): depends on which filing the appearance covers.
//   - Part 3 "client is the Requestor / Applicant / Respondent / Petitioner / Beneficiary" boxes: the client's legal capacity is a determination.
//   - Part 3 Item 7 (entity, authorized signatory): only for an organization client.
//   - Parts 4-5 consent boxes, signatures, dates; Part 9 additional-information blocks.
// Unit type: the Apt / Ste / Flr boxes follow each widget's own tooltip (Line12b_Unit[0]=Suite, [1]=Floor, [2]=Apartment) and are ticked only when the
// canonical profile carries a unit type.

const FORM_CODE = "G-28";
const P2 = "form1[0].#subform[1].";
const P4 = "form1[0].#subform[3].";

const leaf = (field, operator, value) => ({ field, operator, value });
const edge = (fieldName, source, note, extra = {}) => ({ fieldName, source, sourceVerified: false, note, ...extra });
const box = (fieldName, source, value, note) => edge(fieldName, source, note, { transform: { type: "boolean" }, condition: leaf(source, "equals", value) });
const digits = { transform: { type: "digits" } };
const US = leaf("contact.address.country", "equals", "United States");
const NOT_US = leaf("contact.address.country", "not_equals", "United States");

const MAPPED_EDGES = [
  edge(`${P2}Pt3Line5a_FamilyName[0]`, "person.lastName", "Part 3, client's family name."),
  edge(`${P2}Pt3Line5b_GivenName[0]`, "person.firstName", "Part 3, client's given name."),
  edge(`${P2}Pt3Line5c_MiddleName[0]`, "person.middleName", "Part 3, client's middle name."),
  edge(`${P2}Pt3Line4_ReceiptNumber[0]`, "case.receiptNumber", "Part 3, receipt number of the matter (when the case has one)."),
  edge(`${P2}#area[1].Pt3Line8_USCISOnlineAcctNumber[0]`, "person.uscisOnlineAccountNumber", "Part 3, client's USCIS Online Account Number (digits).", digits),
  edge(`${P2}Pt3Line9_ANumber[0]`, "person.alienNumber", "Part 3, client's A-Number (digits only; the box pre-prints the prefix).", digits),
  edge(`${P2}Line9_DaytimeTelephoneNumber[0]`, "contact.phone", "Part 3, client's daytime telephone number.", { transform: { type: "phone" } }),
  edge(`${P2}Line10_MobileTelephoneNumber[0]`, "contact.mobilePhone", "Part 3, client's mobile telephone number.", { transform: { type: "phone" } }),
  edge(`${P2}Line11_EMail[0]`, "contact.email", "Part 3, client's e-mail address."),
  // Part 3, client's mailing address
  edge(`${P2}Line12a_StreetNumberName[0]`, "contact.address.line1", "Part 3, mailing address - street number and name."),
  edge(`${P2}Line12b_AptSteFlrNumber[0]`, "contact.address.line2", "Part 3, mailing address - apartment / suite / floor number."),
  box(`${P2}Line12b_Unit[0]`, "contact.address.unitType", "suite", "Part 3, mailing address - Ste. box."),
  box(`${P2}Line12b_Unit[1]`, "contact.address.unitType", "floor", "Part 3, mailing address - Flr. box."),
  box(`${P2}Line12b_Unit[2]`, "contact.address.unitType", "apartment", "Part 3, mailing address - Apt. box."),
  edge(`${P2}Line12c_CityOrTown[0]`, "contact.address.city", "Part 3, mailing address - city or town."),
  edge(`${P2}Line12d_State[0]`, "contact.address.state", "Part 3, mailing address - state (recognised US state of a US address only).",
    { transform: { type: "usState", countryPath: "contact.address.country" }, condition: US }),
  edge(`${P2}Line12e_ZipCode[0]`, "contact.address.zip", "Part 3, mailing address - ZIP code (US address only).", { condition: US }),
  edge(`${P2}Line12f_Province[0]`, "contact.address.province", "Part 3, mailing address - province (non-US address only).", { condition: NOT_US }),
  edge(`${P2}Line12g_PostalCode[0]`, "contact.address.postalCode", "Part 3, mailing address - postal code (non-US address only).", { condition: NOT_US }),
  edge(`${P2}Line12h_Country[0]`, "contact.address.country", "Part 3, mailing address - country."),
  // continuation page: the client's name repeated
  edge(`${P4}Pt3Line5a_FamilyName[1]`, "person.lastName", "Continuation page header, client's family name (repeat)."),
  edge(`${P4}Pt3Line5b_GivenName[1]`, "person.firstName", "Continuation page header, client's given name (repeat)."),
  edge(`${P4}Pt3Line5c_MiddleName[1]`, "person.middleName", "Continuation page header, client's middle name (repeat)."),
];

const USCIS_USE_ONLY_PATTERNS = [/PDF417BarCode/];
const MAPPED_BY_FIELD_NAME = new Map(MAPPED_EDGES.map((item) => [item.fieldName, item]));

function classifyField(field) {
  const fieldName = field.fieldName || field.pdfFieldName || field.fieldId;
  if (USCIS_USE_ONLY_PATTERNS.some((pattern) => pattern.test(fieldName))) return { status: "uscis_use_only", note: "USCIS-internal barcode field." };
  const mapped = MAPPED_BY_FIELD_NAME.get(fieldName);
  if (mapped) return { status: "mapped", edge: mapped };
  return { status: "manual_entry", note: "Representative identity, eligibility, appearance scope, capacity, consent, signature or additional information - completed by the case manager." };
}

module.exports = { FORM_CODE, MAPPED_EDGES, USCIS_USE_ONLY_PATTERNS, classifyField };
