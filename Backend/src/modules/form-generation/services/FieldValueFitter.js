// Decides what to write into a PDF text field whose /MaxLen is shorter than the case value.
// Owner rule (2026-11-04): NO character limit on any form, ever - an entry is NEVER cut or left out. So:
//   - a value that fits is written unchanged;
//   - a value that only misses its boxes because of separators (spaces, dashes, brackets, dots, slashes - "(555) 123-4567", "A-123-456-789",
//     "123-45-6789") is written without them, so every character still lands in its own printed box (a comb field); nothing is lost - only
//     formatting the boxes print themselves;
//   - anything still longer returns status "too_long" with the WHOLE value: the caller lifts that box's limit (liftFieldLimit below) and
//     writes it in full (FullTextFieldGuard.shrinkLongTextToFit then shrinks the font so it is visible).
// (Before this, a too-long value was cut to the first MaxLen characters / a phone's country code or a ZIP+4 was dropped.)
const SEPARATORS = /[\s\-().\/]+/g;

/** The value with its box separators removed (for one-character-per-box fields). */
function compactForBoxes(value) {
  return String(value ?? "").replace(SEPARATORS, "");
}

function fitTextValue({ value, maxLength }) {
  const text = String(value ?? "");
  if (!maxLength || text.length <= maxLength) return { value: text, status: "unchanged" };
  const compact = compactForBoxes(text);
  if (compact && compact.length <= maxLength) return { value: compact, status: "adjusted", reason: `written without spaces / dashes / brackets so each character sits in its own box (${maxLength} boxes)` };
  return { value: text, status: "too_long", reason: `the whole entry (${text.length} characters) is kept; the box limit of ${maxLength} was lifted for it` };
}

/** Removes one text field's limit (and its box layout) on the working copy so a long entry can be written in full. Never throws. */
function liftFieldLimit(field) {
  try {
    if (field.isCombed?.()) field.disableCombing();
    field.setMaxLength(undefined);
    return true;
  } catch (_error) {
    return false;
  }
}

// ---- dropdown / radio / option-list fields --------------------------------
// pdf-lib's select() throws "Attempted to set invalid field value" unless the
// value is EXACTLY one of the field's options. Real case data is looser: an
// empty answer arrives as "" or [""], codes lose their label ("F1" for the
// option " F1 - STUDENT - ACADEMIC"), and casing/spacing differ. This maps
// the answer onto the field's real option when that is unambiguous, treats an
// empty answer as "nothing selected" (not an error), and otherwise reports the
// value as not available instead of guessing.
const normalizeChoice = (text) => String(text ?? "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
const optionCode = (option) => String(option ?? "").split(" - ")[0];

function fitChoiceValue({ value, options = [] }) {
  const wanted = (Array.isArray(value) ? value : [value])
    .map((item) => (item === null || item === undefined ? "" : String(item)))
    .filter((item) => item.trim() !== "");
  if (!wanted.length) return { status: "empty", values: [] };

  const values = [];
  for (const raw of wanted) {
    const target = normalizeChoice(raw);
    const match =
      options.find((option) => option === raw) ||
      options.find((option) => String(option).trim() === raw.trim()) ||
      options.find((option) => normalizeChoice(option) === target) ||
      options.find((option) => normalizeChoice(optionCode(option)) === target);
    if (!match) {
      return { status: "dropped", values: [], reason: `"${raw}" is not one of the choices on this form; left unselected` };
    }
    values.push(match);
  }
  const changed = values.some((match, index) => match !== wanted[index]);
  return { status: changed ? "adjusted" : "unchanged", values, reason: changed ? `matched to the form's choice "${String(values[0]).trim()}"` : undefined };
}

module.exports = { fitTextValue, fitChoiceValue, compactForBoxes, liftFieldLimit };
