// Which "Part N" of a USCIS form each box sits in, read from the PRINTED part headings ("Part 4. Information About ..."), never from the box names (they do not carry the part
// on every form: I-800's "FamilyNameLastName" is the petitioner's on page 2 and the spouse's on page 3). Pure geometry on the PDF's text layer (pdfjs-dist) plus the boxes' own
// coordinates: a box belongs to the last heading that comes before it in reading order (page, then top to bottom). Fails safe: no headings found -> no part for any box, and the
// caller maps nothing by part.
const MAX_PAGES = 60;
// a real heading is "Part 4. Information About ..." - always with the period; a cross-reference in running text ("see Part 3 of this form", "Part 3, Item 5") has none
const HEADING = /^(Part|Section)\s+(\d{1,2})\s*\.(?:\s|$)/i; // "Section N." heads a supplement of a form made of slices (I-129); it is only looked for when asked through `kinds`

async function loadHeadings(buffer, { kinds = ["Part"] } = {}) {
  const wanted = new Set(kinds.map((kind) => kind.toLowerCase()));
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
        if (match && wanted.has(match[1].toLowerCase())) found.push({ kind: match[1][0].toUpperCase() + match[1].slice(1).toLowerCase(), part: Number(match[2]), page: pageNumber, y: item.transform[5], x: item.transform[4], height });
      }
    }
  } finally {
    await Promise.resolve(task.destroy?.()).catch(() => null);
  }
  // every "Part N." / "Section N." that starts an item is a candidate; orderHeadings keeps the real run (longest increasing sequence, larger print breaking ties) - no size cutoff
  return found;
}

/** Pure. A real heading is printed larger than the body text ("Part 3. Reasons..." at 12 pt against 10 pt body); a cross-reference ("Part 9. Additional Information" in a sentence) is body-sized. */
function onlyHeadingSized(found, textByHeight) {
  let body = 0, most = -1;
  for (const [height, chars] of textByHeight) if (chars > most) { most = chars; body = height; }
  const larger = found.filter((item) => item.height >= body + 1); // the I-129's "Part 1." is printed only 1 pt above its body text; a body-sized cross-reference never qualifies
  return larger.length ? larger : found; // a form that prints headings at body size keeps every candidate
}

// reading order: earlier page first, then higher on the page (a larger y, PDF origin bottom-left) first. Two headings printed SIDE BY SIDE on one line (I-140: "Part 8 ... Part 9 ...")
// share a baseline within SAME_LINE_PT: the left one comes first. (A box has no x, so a box is only ever compared by height.)
const SAME_LINE_PT = 3;
const before = (a, b) => {
  if (a.page !== b.page) return a.page < b.page;
  if (Math.abs(a.y - b.y) <= SAME_LINE_PT && Number.isFinite(a.x) && Number.isFinite(b.x)) return a.x < b.x;
  return a.y > b.y;
};

/**
 * Pure. headings: [{ part, page, y }] in any order. In reading order, the LONGEST run of strictly increasing part numbers is kept (one heading per part): a repeated running header
 * ("Part 1. Information About You (continued)"), a stray reference, or one heading printed slightly out of vertical order never derails the parts after it. Returns the run in reading order.
 */
function orderHeadings(headings) {
  const inOrder = [...headings].sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
  // No absolute font-size rule (sizes differ from form to form): the run is the longest one; between runs of EQUAL length the one made of larger-printed headings wins (a heading is printed at least as
  // large as the running-text cross-reference it competes with), then the earliest. The size only ever breaks a tie, it never excludes a candidate.
  const SIZE_WEIGHT = 0.001;
  const length = new Array(inOrder.length).fill(1);
  const score = inOrder.map((heading) => 1 + SIZE_WEIGHT * (Number(heading.height) || 0));
  const previous = new Array(inOrder.length).fill(-1);
  for (let i = 0; i < inOrder.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (inOrder[j].part >= inOrder[i].part) continue;
      const candidate = score[j] + 1 + SIZE_WEIGHT * (Number(inOrder[i].height) || 0);
      if (candidate > score[i] + 1e-9) { score[i] = candidate; length[i] = length[j] + 1; previous[i] = j; }
    }
  }
  let best = -1;
  for (let i = 0; i < inOrder.length; i += 1) if (best < 0 || score[i] > score[best] + 1e-9 || (Math.abs(score[i] - score[best]) <= 1e-9 && inOrder[i].part < inOrder[best].part)) best = i;
  const run = [];
  for (let i = best; i >= 0; i = previous[i]) run.unshift(inOrder[i]);
  return run;
}

/**
 * Pure. The part a box (page, y = its top edge, x = its left edge) sits in, or 0 when it comes before the first heading.
 * When the nearest heading above is one of SEVERAL printed side by side on one line (I-140: "Part 8" in the left column, "Part 9" in the right), the box belongs to the heading of ITS
 * column: the one furthest right that does not start to the right of the box.
 */
const COLUMN_SLACK_PT = 6;
function partOfBox(ordered, box) {
  let index = -1;
  for (let i = 0; i < ordered.length; i += 1) {
    const heading = ordered[i];
    if (before(heading, box) || (heading.page === box.page && heading.y === box.y)) index = i;
    else break;
  }
  if (index < 0) return 0;
  const chosen = ordered[index];
  if (Number.isFinite(box.x)) {
    const line = ordered.filter((heading) => heading.page === chosen.page && Math.abs(heading.y - chosen.y) <= SAME_LINE_PT && Number.isFinite(heading.x));
    if (line.length > 1) {
      const inColumn = line.filter((heading) => heading.x <= box.x + COLUMN_SLACK_PT).sort((a, b) => b.x - a.x)[0];
      return (inColumn || [...line].sort((a, b) => a.x - b.x)[0]).part;
    }
  }
  return chosen.part;
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
      if (name && !map.has(name)) map.set(name, partOfBox(ordered, { page: field.pageNumber || field.coordinates.pageNumber, y: box.top, x: box.left }));
    }
  } catch (_error) {
    return new Map();
  }
  return map;
}

/**
 * Pure. Which scope a page belongs to: scopes = [{ key, kind: "Part" | "Section", pageRanges: [{ startPage, endPage }] }]. The first scope whose ranges contain the page wins; a page in no scope
 * has none (its boxes are never given a part).
 */
function scopeOfPage(scopes, page) {
  return scopes.find((scope) => (scope.pageRanges || []).some((range) => page >= range.startPage && page <= range.endPage)) || null;
}

/**
 * A form made of a MAIN part (headed "Part N.") and supplements that are slices of the same PDF (each headed "Section N." inside its own page range - the I-129 and its E / Trade / H / H-1B / L /
 * O-P / Q / R supplements). Returns Map(pdf field name -> { scope, n }): the scope a box sits in and its Part / Section number inside THAT scope (0 = above the scope's first heading, e.g. the
 * petitioner / beneficiary name boxes at the top of a supplement). Each scope is ordered on its own, so "Section 1" of one supplement never mixes with "Section 1" of another.
 * Never throws (an unreadable PDF -> empty map).
 */
async function scopeMapFor(template, scopes) {
  const map = new Map();
  try {
    const storage = require("../../uploads/storage.service");
    const key = template.artifacts?.form?.storageKey || template.pdfStorageKey;
    if (!key || !scopes?.length) return map;
    const all = await loadHeadings(await storage.readBuffer(key), { kinds: ["Part", "Section"] });
    const orderedByScope = new Map();
    for (const scope of scopes) {
      const inScope = all.filter((heading) => heading.kind === scope.kind && scopeOfPage([scope], heading.page));
      orderedByScope.set(scope.key, inScope.length ? orderHeadings(inScope) : []);
    }
    for (const field of template.formFields || []) {
      const box = field.coordinates?.boundingBox;
      const page = field.pageNumber || field.coordinates?.pageNumber;
      const scope = box && scopeOfPage(scopes, page);
      const name = field.fieldName || field.pdfFieldName;
      if (!scope || !name || map.has(name)) continue;
      map.set(name, { scope: scope.key, n: partOfBox(orderedByScope.get(scope.key), { page, y: box.top, x: box.left }) });
    }
  } catch (_error) {
    return new Map();
  }
  return map;
}

module.exports = { partMapFor, scopeMapFor, scopeOfPage, orderHeadings, partOfBox, loadHeadings, onlyHeadingSized };
