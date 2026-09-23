// Final phase (USCIS forms production readiness) - genuine production
// defect: pdf-lib's own appearance-regeneration pass (run internally by
// both `form.flatten()` and `pdf.save()`, and therefore hit by BOTH real
// rendering engines - confirmed live: PDFRenderer AND AdobeFormRenderer,
// which also does its own local `sourcePdf.save()` before uploading to
// Adobe, crash identically) throws `RichTextFieldReadError` for any
// AcroForm text field flagged "rich text" (PDF spec bit 26) that currently
// has no plain-text /V value - pdf-lib can't derive a default appearance
// from raw, unparsed rich-text XML. Confirmed against I-485's real
// template (field `P14_Line5_AdditionalInfo`), but this is a generic PDF
// field-type limitation, not an I-485-specific one - any USCIS form could
// contain a rich-text field.
//
// Fix uses pdf-lib's own OFFICIAL, public API for exactly this situation -
// `PDFTextField.isRichFormatted()` / `.disableRichFormatting()` (which
// simply clears that one AcroForm flag) - not a workaround invented here.
// Clearing the flag on an EMPTY rich-text field has no visible effect (the
// field renders as it always would - blank, since it holds no value
// either way) and never touches a field's actual /V value, other field
// types (checkboxes, radios, dropdowns, signatures, barcodes), or any
// field that already has a value (only the empty+rich-text combination
// pdf-lib itself cannot read is disarmed).
function disableEmptyRichTextFields(form) {
  const disabled = [];
  for (const field of form.getFields()) {
    if (typeof field.isRichFormatted !== "function" || typeof field.disableRichFormatting !== "function") continue;
    if (!field.isRichFormatted()) continue;
    let hasValue = true;
    try {
      hasValue = Boolean(field.getText());
    } catch (error) {
      hasValue = false; // exactly the RichTextFieldReadError case this guard exists for.
    }
    if (hasValue) continue; // a rich-text field WITH a value is left untouched - out of scope, never seen in practice here.
    field.disableRichFormatting();
    disabled.push(field.getName());
  }
  return disabled;
}

module.exports = { disableEmptyRichTextFields };
