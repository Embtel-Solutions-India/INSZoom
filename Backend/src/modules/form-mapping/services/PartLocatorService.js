// Which "Part N" of a USCIS form each box sits in, read from the PRINTED part headings ("Part 4. Information About ..."), never from the box names (they do not carry the part
// on every form: I-800's "FamilyNameLastName" is the petitioner's on page 2 and the spouse's on page 3). Pure geometry on the PDF's text layer (pdfjs-dist) plus the boxes' own
// coordinates: a box belongs to the last heading that comes before it in reading order (page, then top to bottom). Fails safe: no headings found -> no part for any box, and the
// caller maps nothing by part.
const MAX_PAGES = 60;
// a real heading is "Part 4. Information About ..." - always with the period; a cross-reference in running text ("see Part 3 of this form", "Part 3, Item 5") has none
const HEADING = /^Part\s+(\d{1,2})\s*\.(?:\s|$)/i;

async function loadHeadings(buffer) {
  const pdfjs = await require("../../../utils/pdfjsShared").loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), disableFontFace: true, isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
  const doc = await task.promise;
  const found = [];
  const textByHeight = new Map(); // text height -> characters printed at it (the most common one is the body text)
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(doc.numPages, MAX_PAGES); pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      for (const item of content.items) {
        const text = String(item.str || "").trim();
        if (!text) continue;
        const height = Math.round(item.height || 0);
        textByHeight.set(height, (textByHeight.get(height) || 0) + text.length);
        const match = HEADING.exec(text);
        if (match) found.push({ part: Number(match[1]), page: pageNumber, y: item.transform[5], height });
      }
    }
  } finally {
    await Promise.resolve(task.destroy?.()).catch(() => null);
  }
  return onlyHeadingSized(found, textByHeight);
}

/** Pure. A real heading is printed larger than the body text ("Part 3. Reasons..." at 12 pt against 10 pt body); a cross-reference ("Part 9. Additional Information" in a sentence) is body-sized. */
function onlyHeadingSized(found, textByHeight) {
  let body = 0, most = -1;
  for (const [height, chars] of textByHeight) if (chars > most) { most = chars; body = height; }
  const larger = found.filter((item) => item.height >= body + 1.5);
  return larger.length ? larger : found; // a form that prints headings at body size keeps every candidate
}

// reading order: earlier page first, then higher on the page (a larger y, PDF origin bottom-left) first
const before = (a, b) => a.page < b.page || (a.page === b.page && a.y > b.y);

/**
 * Pure. headings: [{ part, page, y }] in any order. In reading order, the LONGEST run of strictly increasing part numbers is kept (one heading per part): a repeated running header
 * ("Part 1. Information About You (continued)"), a stray reference, or one heading printed slightly out of vertical order never derails the parts after it. Returns the run in reading order.
 */
function orderHeadings(headings) {
  const inOrder = [...headings].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  const length = new Array(inOrder.length).fill(1);
  const previous = new Array(inOrder.length).fill(-1);
  for (let i = 0; i < inOrder.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (inOrder[j].part < inOrder[i].part && length[j] + 1 > length[i]) { length[i] = length[j] + 1; previous[i] = j; }
    }
  }
  let best = -1;
  for (let i = 0; i < inOrder.length; i += 1) if (best < 0 || length[i] > length[best] || (length[i] === length[best] && inOrder[i].part < inOrder[best].part)) best = i;
  const run = [];
  for (let i = best; i >= 0; i = previous[i]) run.unshift(inOrder[i]);
  return run;
}

/** Pure. The part a box (page, y = its top edge) sits in, or 0 when it comes before the first heading. */
function partOfBox(ordered, box) {
  let part = 0;
  for (const heading of ordered) {
    if (before(heading, box) || (heading.page === box.page && heading.y === box.y)) part = heading.part;
    else break;
  }
  return part;
}

/**
 * The part of every box of a stored template: Map(pdf field name -> part number). Reads the template's own stored PDF; never throws (an unreadable PDF -> empty map).
 */
async function partMapFor(template) {
  const map = new Map();
  try {
    const storage = require("../../uploads/storage.service");
    const key = template.artifacts?.form?.storageKey || template.pdfStorageKey;
    if (!key) return map;
    const ordered = orderHeadings(await loadHeadings(await storage.readBuffer(key)));
    if (!ordered.length) return map;
    for (const field of template.formFields || []) {
      const box = field.coordinates?.boundingBox;
      if (!box) continue;
      const name = field.fieldName || field.pdfFieldName;
      if (name && !map.has(name)) map.set(name, partOfBox(ordered, { page: field.pageNumber || field.coordinates.pageNumber, y: box.top }));
    }
  } catch (_error) {
    return new Map();
  }
  return map;
}

module.exports = { partMapFor, orderHeadings, partOfBox, loadHeadings, onlyHeadingSized };
