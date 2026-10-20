// Free-text answers must reach the downloaded PDF in FULL - never cut, never blanked - however long
// they are. Two things in a USCIS template stand in the way, and this guard removes both on the
// working copy of the template (the stored template PDF is never modified):
//
//   1. The field's own /MaxLen (and "comb" layout, which only works for exactly MaxLen characters).
//      liftTextLengthLimits() runs BEFORE values are written, so FieldValueFitter sees no limit and
//      writes the entry unchanged.
//   2. The widget's fixed width/height. A long entry at the field's normal font size would be clipped
//      by the box, so shrinkLongTextToFit() runs AFTER values are written and reduces the font size
//      of exactly those fields whose text would not fit, until the whole text is visible. Entries
//      that already fit keep the form's own font size, so ordinary forms render exactly as before.
//
// Fields whose font size is "auto" (0) are left alone: pdf-lib (and PDF viewers) already shrink the
// text of an auto-size field to fit its box.
const FONT_SIZE_IN_DA = /([\d.]+)\s+Tf/;
const WIDGET_PADDING_PT = 4; // border + inner padding, both sides
const FIT_SAFETY = 0.97; // measured with Helvetica; real fonts differ slightly
const MIN_FONT_SIZE_PT = 1;

const isTextField = (field) => (field.constructor?.name || "").includes("TextField");

// valueFor(pdfFieldName) -> the text that is about to be written into that field (undefined when none is). Given it, a comb field (one character per printed
// box) whose text FITS its boxes keeps its /MaxLen and comb layout, so every character lands in its own box in the downloaded PDF; a text longer than its boxes is
// still written in full as ordinary text. Without it every limit is lifted, as before.
function liftTextLengthLimits(form, valueFor) {
  let lifted = 0;
  let fields = [];
  try {
    fields = form.getFields();
  } catch (error) {
    return 0; // best effort - never let this guard stop a download
  }
  for (const field of fields) {
    if (!isTextField(field)) continue;
    try {
      const maxLength = field.getMaxLength?.();
      if (maxLength === undefined) continue;
      if (valueFor && field.isCombed?.()) {
        const text = valueFor(field.getName());
        if (text !== undefined && String(text).length <= maxLength) continue; // keep the boxes
      }
      if (field.isCombed?.()) field.disableCombing();
      field.setMaxLength(undefined);
      lifted += 1;
    } catch (error) {
      // leave this field as it was - FieldValueFitter still reports anything it has to cut
    }
  }
  return lifted;
}

function currentFontSize(field) {
  const match = String(field.acroField.getDefaultAppearance() || "").match(FONT_SIZE_IN_DA);
  return match ? Number(match[1]) : undefined;
}

function wrappedLineCount(font, text, size, maxWidth) {
  let lines = 0;
  for (const paragraph of String(text).split(/\r\n|\r|\n/)) {
    lines += 1;
    let lineWidth = 0;
    for (const word of paragraph.split(" ")) {
      const wordWidth = font.widthOfTextAtSize(`${word} `, size);
      if (lineWidth > 0 && lineWidth + wordWidth > maxWidth) {
        lines += 1;
        lineWidth = 0;
      }
      lineWidth += wordWidth;
      // a single word wider than the box wraps by character in viewers - count its extra lines
      if (wordWidth > maxWidth) lines += Math.floor(wordWidth / maxWidth);
    }
  }
  return lines;
}

function fittedSize(font, field, text, size, rect) {
  const availableWidth = (rect.width - WIDGET_PADDING_PT) * FIT_SAFETY;
  const availableHeight = rect.height - WIDGET_PADDING_PT;
  if (availableWidth <= 0) return size;
  if (field.isMultiline?.()) {
    let candidate = size;
    while (candidate > MIN_FONT_SIZE_PT && wrappedLineCount(font, text, candidate, availableWidth) * candidate * 1.15 > availableHeight) {
      candidate = Math.max(MIN_FONT_SIZE_PT, Math.floor((candidate - 0.5) * 10) / 10);
    }
    return candidate;
  }
  const textWidth = font.widthOfTextAtSize(text, size);
  if (textWidth <= availableWidth) return size;
  return Math.max(MIN_FONT_SIZE_PT, Math.floor(((size * availableWidth) / textWidth) * 10) / 10);
}

// Returns the fields whose font size was reduced: [{ pdfField, from, to }].
async function shrinkLongTextToFit(pdfDoc, form) {
  const shrunk = [];
  let fields = [];
  let StandardFonts;
  try {
    ({ StandardFonts } = require("pdf-lib"));
    fields = form.getFields();
  } catch (error) {
    return shrunk; // best effort - never let this guard stop a download
  }
  let font = null;
  for (const field of fields) {
    if (!isTextField(field)) continue;
    try {
      const text = field.getText();
      if (!text) continue;
      const size = currentFontSize(field);
      if (!size) continue; // auto size (0) or unknown - nothing to do
      const widgets = field.acroField.getWidgets();
      if (!widgets.length) continue;
      // The same field can appear on several widgets - the narrowest one decides.
      const rect = widgets.map((widget) => widget.getRectangle()).reduce((a, b) => (b.width < a.width ? b : a));
      font = font || (await pdfDoc.embedFont(StandardFonts.Helvetica));
      const next = fittedSize(font, field, text, size, rect);
      if (next < size) {
        field.setFontSize(next);
        shrunk.push({ pdfField: field.getName(), from: size, to: next });
      }
    } catch (error) {
      // text that Helvetica cannot measure, rich text, ... - leave this field as it is
    }
  }
  return shrunk;
}

module.exports = { liftTextLengthLimits, shrinkLongTextToFit };
