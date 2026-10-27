// Labels read from the text PRINTED beside a box, for the one case where the PDF's own metadata cannot be trusted: a form whose tooltips / field names were copied from
// another form (G-1650's Checking / Savings boxes are named "CB_CreditCardType" and carry the tooltips "Master Card" / "Visa"). Pure geometry on the page's text layer
// (pdfjs-dist), no AI and no guessing: a check box / radio gets the text immediately to its right on the same line, and only when that text shares no word with either the
// box's tooltip or its field name. Everything fails safe - any error, or a form with no text layer, returns nothing and the existing label is kept.
const STOP = new Set(["select", "this", "box", "for", "check", "enter", "the", "and", "your", "form", "item", "part", "page", "any"]);
// the usual USCIS abbreviations count as the word they stand for ("Ste." is "Suite")
const EXPAND = { ste: "suite", apt: "apartment", flr: "floor", num: "number", amt: "amount" };
const words = (text) => String(text || "").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).map((word) => EXPAND[word] || word).filter((word) => word.length >= 3 && !STOP.has(word));

const MAX_PAGES = 60;
const MAX_GAP_PT = 70; // how far right of the box the printed label may start
const JOIN_GAP_PT = 6; // text pieces closer than this on one line belong to the same label

async function loadTextItems(buffer, pageNumbers) {
  const pdfjs = await require("../../../utils/pdfjsShared").loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const pages = new Map();
  try {
    for (const pageNumber of [...pageNumbers].filter((n) => n >= 1 && n <= Math.min(doc.numPages, MAX_PAGES))) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.set(pageNumber, content.items.filter((item) => item.str && item.str.trim()).map((item) => ({ text: item.str.trim(), x: item.transform[4], y: item.transform[5], width: item.width || 0, height: item.height || 8 })));
    }
  } finally {
    await Promise.resolve(task.destroy?.()).catch(() => null);
  }
  return pages;
}

/** Pure: the printed label to the right of one box, or undefined. `items` are one page's text pieces (bottom-left origin, like the box). */
function labelRightOf(box, items) {
  const midY = box.bottom + (box.top - box.bottom) / 2;
  const line = items.filter((item) => Math.abs(item.y + item.height / 3 - midY) <= Math.max(5, item.height) && item.x >= box.right - 1).sort((a, b) => a.x - b.x);
  if (!line.length || line[0].x - box.right > MAX_GAP_PT) return undefined;
  const parts = [line[0]];
  for (const item of line.slice(1)) {
    const last = parts[parts.length - 1];
    if (item.x - (last.x + last.width) > JOIN_GAP_PT) break;
    parts.push(item);
  }
  const text = parts.map((part) => part.text).join(" ").replace(/\s+/g, " ").trim();
  // a short label only: a Yes / No answer or a whole sentence beside a box is not a label to replace the form's own with
  return /[A-Za-z]{3}/.test(text) && text.length <= 40 && text.split(" ").length <= 5 && !/^(?:yes|no|none|n\/a)(?![a-z])/i.test(text) ? text : undefined;
}

/** Pure: true when the printed text contradicts BOTH the tooltip and the field name (so neither can be the box's real meaning). */
function contradicts(printed, tooltip, fieldName) {
  const printedWords = new Set(words(printed));
  if (!printedWords.size) return false;
  const stem = String(fieldName || "").split(".").pop().replace(/\[\d+\]$/, "").replace(/_/g, " ");
  const known = new Set([...words(tooltip), ...words(stem)]);
  // a word of the printed text that matches (or is the start / end of) a known word is not a contradiction ("Check" / "Checking")
  return ![...printedWords].some((word) => [...known].some((other) => other === word || (Math.min(word.length, other.length) >= 4 && (other.startsWith(word) || word.startsWith(other)))));
}

/**
 * fields: scanned fields (with `tooltip`, coordinates and pageNumber). Returns Map(fieldName -> printed label) for check boxes / radios whose metadata is contradicted by the
 * text printed beside them. Never throws.
 */
async function collect(buffer, fields) {
  const result = new Map();
  try {
    const boxes = (fields || []).filter((field) => ["checkbox", "radio"].includes(String(field.type || "").toLowerCase()) && field.coordinates?.boundingBox);
    if (!boxes.length || !buffer) return result;
    const pageOf = (field) => field.pageNumber || field.coordinates.pageNumber;
    const pages = await loadTextItems(buffer, new Set(boxes.map(pageOf)));
    // A box is relabelled only when its WHOLE group (the boxes of one question: same name, different [n]) is contradicted by the text printed beside it. If even one box's
    // printed text agrees with its tooltip or name, the geometry or the tooltips are as likely to be right as the guess, and the group is left alone (I-131A's Suite /
    // Floor / Apartment boxes carry their labels on the other side of the box; G-1650's Checking / Savings group is contradicted in every box).
    const groups = new Map();
    for (const field of boxes) {
      const printed = labelRightOf(field.coordinates.boundingBox, pages.get(pageOf(field)) || []);
      const group = String(field.fieldName || "").replace(/\[\d+\]$/, "");
      const entry = groups.get(group) || [];
      entry.push({ field, printed, bad: Boolean(printed) && contradicts(printed, field.tooltip, field.fieldName) });
      groups.set(group, entry);
    }
    for (const [group, entry] of groups) {
      if (entry.length < 2 || !entry.every((item) => item.printed && item.bad)) continue;
      // the same words, only in a different order (suite / floor / apartment read as floor / apartment / suite): the labels are on the other side of the boxes, not wrong
      if (!contradicts(entry.map((item) => item.printed).join(" "), entry.map((item) => item.field.tooltip).join(" "), group.split(".").pop())) continue;
      if (new Set(entry.map((item) => item.printed)).size !== entry.length) continue; // two boxes cannot carry the same label
      entry.forEach((item) => result.set(item.field.fieldName, item.printed));
    }
  } catch (_error) {
    return new Map();
  }
  return result;
}

module.exports = { collect, labelRightOf, contradicts, loadTextItems };
