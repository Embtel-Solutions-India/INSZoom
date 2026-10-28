// A news headline is shown with its opening phrase in bold - up to the first comma, period, semicolon or colon - and the rest in regular weight.
// A punctuation mark inside the first few characters ("U.S. ...", "No. 5") is not an end of phrase, so a short abbreviation never becomes the whole bold part.
const MIN_LEAD = 12;

/** { lead, rest } - lead is bold (the punctuation mark stays with it); rest may be "". A title with no such mark is all lead. */
export function splitHeadline(title) {
  const text = String(title || "").trim();
  const pattern = /[,.;:]/g;
  let match;
  while ((match = pattern.exec(text))) {
    const end = match.index + 1;
    const next = text[end];
    // "1.5", "U.S.", "e.g." - a mark with no space after it, or too early in the title, does not end the phrase
    if (end >= MIN_LEAD && (next === undefined || /\s/.test(next))) return { lead: text.slice(0, end), rest: text.slice(end) };
  }
  return { lead: text, rest: "" };
}
