// HTML -> plain text for evidence snapshots. Deliberately its own small, tested function (not the scanner's stripTags): the extracted text is
// HASHED and stored as evidence, so its behavior must stay stable and must not change when unrelated code is edited.
//
// Scripts, styles, comments and tags are removed; the common HTML entities are decoded; all whitespace collapses to single spaces. The reviewer's
// verbatim quote is compared against this text after the same whitespace collapsing (see EvidenceVerifier).

const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“",
  ndash: "–", mdash: "—", hellip: "…", copy: "©", reg: "®", sect: "§", middot: "·", bull: "•",
};

function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, decimal) => safeCodePoint(parseInt(decimal, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name.toLowerCase()) ? NAMED_ENTITIES[name.toLowerCase()] : match));
}

function safeCodePoint(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return " ";
  return String.fromCodePoint(value);
}

/** Collapses every run of whitespace (including non-breaking spaces) to one space and trims. */
function collapseWhitespace(text) {
  return String(text ?? "").replace(/[\s ​]+/g, " ").trim();
}

function htmlToText(html) {
  const withoutBlocks = String(html ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ");
  // block-level boundaries become a space so words from adjacent elements never fuse
  const spaced = withoutBlocks.replace(/<\/?(p|div|br|li|ul|ol|tr|td|th|h[1-6]|section|article|header|footer|main|table|blockquote)\b[^>]*>/gi, " ");
  return collapseWhitespace(decodeEntities(spaced.replace(/<[^>]*>/g, " ")));
}

module.exports = { htmlToText, collapseWhitespace, decodeEntities };
