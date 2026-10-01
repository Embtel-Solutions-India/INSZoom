// Decides what to write into a PDF text field whose maxLength is shorter than
// the case value. Without this, pdf-lib throws ExceededMaxLengthError, the
// field stays blank, and PDFFidelityService then rejected the ENTIRE download
// (422) because a sampled field read back empty - confirmed live on I-907
// (a "+919354596545" phone in a 10-char field, a 6-digit ZIP in a 5-char
// field) and I-131 (a 25-char email in a 15-char field).
//
// Only normalizations that cannot change the meaning of the value are applied:
//   - phone/fax: keep digits only; if still too long, keep the LAST maxLength
//     digits (drops a country-code prefix such as +91 / 1)
//   - ZIP: keep digits only, then the first maxLength digits (ZIP+4 forms have
//     a separate 4-digit field)
// Anything else (names, emails, street lines, ...) is NEVER truncated - a cut
// email or legal name is worse than a blank the case manager can see and
// complete - so it is reported as "dropped" and left empty.
const PHONE_FIELD = /(phone|mobile|fax)/i;
const ZIP_FIELD = /zip/i;

function fitTextValue({ pdfField, value, maxLength }) {
  const text = String(value ?? "");
  if (!maxLength || text.length <= maxLength) return { value: text, status: "unchanged" };

  if (PHONE_FIELD.test(pdfField)) {
    const digits = text.replace(/\D/g, "");
    if (digits.length && digits.length <= maxLength) return { value: digits, status: "adjusted", reason: `phone reformatted to digits to fit ${maxLength} characters` };
    if (digits.length > maxLength) return { value: digits.slice(-maxLength), status: "adjusted", reason: `phone country code removed to fit ${maxLength} characters` };
  }
  if (ZIP_FIELD.test(pdfField)) {
    const digits = text.replace(/\D/g, "");
    if (digits.length) return { value: digits.slice(0, maxLength), status: "adjusted", reason: `ZIP shortened to ${maxLength} digits` };
  }
  return { value: "", status: "dropped", reason: `value is ${text.length} characters but the PDF field allows ${maxLength}; left blank` };
}

module.exports = { fitTextValue };
