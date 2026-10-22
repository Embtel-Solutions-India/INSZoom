// Phase 7.5 - registry-free segmentation of a parent USCIS PDF into its core form, its embedded supplements ("components") and any unclaimed trailing run.
//
// PURE: it reads per-page text only (no database, no storage, no network). The registry-driven discovery (USCISFormComponentDiscoveryService) still decides which
// components are ACTIVE; the segmenter adds what the registry could not see:
//   - the REAL boundaries of every supplement heading in the PDF (a supplement nobody registered is a NEW-COMPONENT CANDIDATE, never absorbed into its neighbour's range);
//   - the stable code a segment already has (carried from the registry / the previous edition by heading similarity, so a changed printed heading never changes a code);
//   - whether every page is core, one component, or an unclaimed run (the "no vacuous pass" check of the certification).
//
// Heading rule (deliberately narrow, tested on the live I-129): a component starts on a page whose FIRST lines (after the "Page N of M / Form X Edition" header line and
// before "Department of Homeland Security", "Part N.", "Section N." or an item number) read like a title ending in "Supplement(s)", optionally "to Form X".
// A heading on page 1 is the document's own title (a standalone supplement PDF such as Supplement A to I-485), never an embedded component.

// ----- shared helpers (moved here unchanged from USCISFormComponentDiscoveryService so there is ONE copy; the service re-exports them) -----
const PAGE_FURNITURE = /Page\s+\d+\s+of\s+\d+|Form\s+[A-Z]{1,4}-\d+[A-Z]*\s+Edition\s+[\d/]+/gi;
const stripPageFurniture = (text) => String(text || "").replace(PAGE_FURNITURE, "");

function textSimilarity(a, b) {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (!tokensA.size || !tokensB.size) return 0;
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared += 1;
  return shared / Math.max(tokensA.size, tokensB.size);
}

// Trailing pages that are near-identical to each other (boilerplate closing sections) are detected by simple token-overlap similarity, not assumed to be a fixed count.
function findTrailingBoilerplateStart(pages) {
  for (let i = pages.length - 1; i > 0; i -= 1) {
    if (textSimilarity(pages[i], pages[i - 1]) >= 0.6) continue;
    return i + 1; // 1-indexed page after the last dissimilar pair
  }
  return pages.length + 1; // no boilerplate tail detected
}

// ----- heading detection -----
const HEADER_LINE = /^Page\s+\d+\s+of\s+\d+\b/i;
const EDITION_LINE = /\bForm\s+[A-Z]{1,4}-\d+[A-Z]*\s+Edition\s+[\d/]+/i;
const STOP_LINE = /^(Department of Homeland Security|U\.S\. Citizenship|USCIS$|Form\s+[A-Z]{1,4}-\d|OMB\s+No|Part\s+\d+\b|Section\s+\d+\b|\d+[a-z]?\.\s|Item\s+Number)/i;
const HEADING_SHAPE = /^[^.!?;:]{3,140}\bSupplements?(?:\s+to\s+Form\s+[A-Z]{1,4}-\d+[A-Z]*)?$/i;

/** The component heading printed at the top of one page's text, or null. Never reads the page body. */
function headingOf(pageText) {
  const lines = String(pageText || "").split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean)
    .filter((line) => !HEADER_LINE.test(line) && !EDITION_LINE.test(line));
  const lead = [];
  for (const line of lines) {
    if (STOP_LINE.test(line)) break;
    lead.push(line);
    if (lead.length === 3) break;
  }
  for (let k = 1; k <= lead.length; k += 1) {
    const candidate = lead.slice(0, k).join(" ");
    if (HEADING_SHAPE.test(candidate)) return candidate;
  }
  return null;
}

// ----- names, slugs, codes -----
const slugOf = (text) => String(text || "").replace(/\bto\s+Form\s+[A-Z]{1,4}-\d+[A-Z]*\b/i, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
const parentSlug = (parentFormCode) => String(parentFormCode || "").replace(/[^A-Za-z0-9]/g, "");
const derivedCode = (parentFormCode, text) => `${parentSlug(parentFormCode)}_${slugOf(text).slice(0, 24)}`;

/** Comparable token set of a heading / registry name: lower case, "to Form X" removed, plural forms folded, number-only and "and" tokens dropped, single-letter codes kept. */
function nameTokens(text) {
  const base = String(text || "").toLowerCase().replace(/\bto\s+form\s+[a-z]{1,4}-\d+[a-z]*\b/g, " ").replace(/classifications/g, "classification").replace(/supplements/g, "supplement");
  return new Set(base.split(/[^a-z0-9]+/).filter((token) => token && token !== "and" && !/^\d+$/.test(token)));
}
function nameSimilarity(a, b) {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.size || !y.size) return 0;
  let shared = 0;
  for (const token of x) if (y.has(token)) shared += 1;
  return shared / (x.size + y.size - shared);
}

const CARRY_THRESHOLD = 0.6;

/**
 * One-to-one carry of existing codes onto headings. candidates: [{ componentCode, name, inUse?, source: "registry" | "previous" }].
 * Best similarity first; on a tie the code something already depends on (inUse), then a registry row, wins. Returns Map(headingIndex -> candidate).
 */
function carryCodes(headings, candidates) {
  const pairs = [];
  headings.forEach((heading, index) => {
    candidates.forEach((candidate) => {
      const score = nameSimilarity(heading, candidate.name);
      if (score >= CARRY_THRESHOLD) pairs.push({ index, candidate, score });
    });
  });
  const rank = (pair) => pair.score * 10 + (pair.candidate.inUse ? 2 : 0) + (pair.candidate.source === "registry" ? 1 : 0);
  pairs.sort((a, b) => rank(b) - rank(a) || a.index - b.index);
  const claimedHeadings = new Set();
  const claimedCodes = new Set();
  const carried = new Map();
  for (const pair of pairs) {
    if (claimedHeadings.has(pair.index) || claimedCodes.has(pair.candidate.componentCode)) continue;
    claimedHeadings.add(pair.index);
    claimedCodes.add(pair.candidate.componentCode);
    carried.set(pair.index, { ...pair.candidate, score: pair.score });
  }
  return carried;
}

/**
 * Segments a parent PDF.
 *   pages: per-page text (index 0 = page 1). parentFormCode: "I-129".
 *   candidates: codes that already exist (registry rows and the previous edition's definitions) - see carryCodes.
 *   previous: optional { pages: [text], components: [{ componentCode, name, startPage, endPage }] } of the previous edition, used to recognise a HEADINGLESS run
 *     (I-129 "Additional Beneficiary Information", pages 37-38, has no heading) by text similarity with the same run of the previous edition.
 * Returns { totalPages, boilerplateStart, segments: [{ kind: "core" | "component" | "tail", startPage, endPage, headingText?, slug?, componentCode?, codeSource?, matchedName?, score? }], unclaimed: [pages] }.
 *   kind "component" with codeSource "carried" is a known component; "derived" is a NEW-COMPONENT CANDIDATE (no registry row, no previous counterpart);
 *   kind "tail" is the run after the last component that no heading and no previous counterpart accounts for (an unclaimed run).
 */
function segment({ pages, parentFormCode, candidates = [], previous = null, similarity = 0.7 } = {}) {
  const list = Array.isArray(pages) ? pages : [];
  const total = list.length;
  const boilerplateStart = findTrailingBoilerplateStart(list);
  const starts = [];
  list.forEach((text, index) => {
    if (index === 0) return; // page 1 is the document's own title, never an embedded component
    const heading = headingOf(text);
    if (heading) starts.push({ startPage: index + 1, headingText: heading });
  });
  const carried = carryCodes(starts.map((item) => item.headingText), candidates);
  const segments = [];
  const firstStart = starts.length ? starts[0].startPage : null;
  if (total) segments.push({ kind: "core", startPage: 1, endPage: firstStart ? firstStart - 1 : total });
  let lastEnd = firstStart ? firstStart - 1 : total;
  starts.forEach((item, i) => {
    const nextStart = starts[i + 1]?.startPage;
    const provisionalEnd = Math.min(nextStart ? nextStart - 1 : total, boilerplateStart - 1);
    const endPage = Math.max(item.startPage, provisionalEnd);
    const match = carried.get(i);
    segments.push({
      kind: "component", startPage: item.startPage, endPage, headingText: item.headingText, slug: slugOf(item.headingText),
      componentCode: match ? match.componentCode : derivedCode(parentFormCode, item.headingText), codeSource: match ? "carried" : "derived",
      ...(match ? { matchedName: match.name, score: Number(match.score.toFixed(3)) } : {}),
    });
    lastEnd = endPage;
  });
  const unclaimed = [];
  if (starts.length && lastEnd < total) {
    // a headingless run after the last component: a previous-edition component with the same text keeps its code, otherwise it is an unclaimed run
    const tailText = stripPageFurniture(list.slice(lastEnd).join(" "));
    let counterpart = null;
    if (previous?.pages?.length && Array.isArray(previous.components)) {
      for (const component of previous.components) {
        const oldText = stripPageFurniture(previous.pages.slice((component.startPage || 1) - 1, component.endPage || previous.pages.length).join(" "));
        if (textSimilarity(oldText, tailText) >= similarity) { counterpart = component; break; }
      }
    }
    if (counterpart) segments.push({ kind: "component", startPage: lastEnd + 1, endPage: total, headingText: null, slug: slugOf(counterpart.name), componentCode: counterpart.componentCode, codeSource: "carried", matchedName: counterpart.name, score: 1, headingless: true });
    else {
      segments.push({ kind: "tail", startPage: lastEnd + 1, endPage: total });
      for (let page = lastEnd + 1; page <= total; page += 1) unclaimed.push(page);
    }
  }
  return { totalPages: total, boilerplateStart, segments, unclaimed };
}

/**
 * Pure: components_slice plausibility (the certification, mode "on"). results = the discovery results [{ componentCode, status, pageRanges, fieldCount, verificationMethod? }],
 * previousDefs = the previous edition's ACTIVE definitions [{ componentCode, pageRanges, fieldIds? / fieldCount? }]. Returns problems[] (empty = fine).
 *   - no unclaimed run: every page from the first component start on is covered by a result range;
 *   - a new-component candidate (nobody registered it) is a problem to resolve, not something to ignore;
 *   - an ACTIVE component must have fields (non-vacuous also on a first edition);
 *   - a component the previous edition served must keep a plausible size (page span and field count within `tolerance` x).
 */
function evaluateComponentSlice({ results = [], totalPages = 0, previousDefs = [], tolerance = 2.5 } = {}) {
  const problems = [];
  const span = (ranges) => (ranges || []).reduce((sum, range) => sum + Math.max(0, (range.endPage || 0) - (range.startPage || 0) + 1), 0);
  // only components with a REAL range count: an ACTIVE one or a new-component candidate (a REVIEW_REQUIRED registry entry that matched no page carries a placeholder range 1-1)
  const withRanges = results.filter((item) => item.pageRanges?.length && (item.status === "ACTIVE" || item.verificationMethod === "segmenter_new_component_candidate"));
  if (!withRanges.length) return problems; // a parent with no components at all (most forms): nothing to slice, nothing vacuous to check
  const firstStart = Math.min(...withRanges.flatMap((item) => item.pageRanges.map((range) => range.startPage)));
  const covered = new Set();
  withRanges.forEach((item) => item.pageRanges.forEach((range) => { for (let p = range.startPage; p <= range.endPage; p += 1) covered.add(p); }));
  const last = totalPages || Math.max(...withRanges.flatMap((item) => item.pageRanges.map((range) => range.endPage)));
  const unclaimed = [];
  for (let p = firstStart; p <= last; p += 1) if (!covered.has(p)) unclaimed.push(p);
  if (unclaimed.length) problems.push(`pages ${unclaimed.join(", ")} belong to no component (an unclaimed run)`);
  for (const item of results) {
    if (item.verificationMethod === "segmenter_new_component_candidate") problems.push(`an unregistered supplement was found on pages ${item.pageRanges?.[0]?.startPage}-${item.pageRanges?.[0]?.endPage} (${item.componentCode}); it needs a registry entry before it can be used`);
    if (item.status === "ACTIVE" && !(item.fieldCount > 0)) problems.push(`component ${item.componentCode} is active but has no fields`);
  }
  const byCode = new Map(results.map((item) => [item.componentCode, item]));
  for (const old of previousDefs) {
    const now = byCode.get(old.componentCode);
    if (!now || now.status !== "ACTIVE") continue; // a missing one is reported by the existing readiness check
    const spanRatio = span(now.pageRanges) / Math.max(1, span(old.pageRanges));
    if (spanRatio > tolerance || spanRatio < 1 / tolerance) problems.push(`component ${old.componentCode} changed size from ${span(old.pageRanges)} to ${span(now.pageRanges)} pages`);
    const oldFields = old.fieldCount ?? old.fieldIds?.length ?? 0;
    if (oldFields > 0) {
      const fieldRatio = (now.fieldCount || 0) / oldFields;
      if (fieldRatio > tolerance || fieldRatio < 1 / tolerance) problems.push(`component ${old.componentCode} changed from ${oldFields} to ${now.fieldCount || 0} fields`);
    }
  }
  return problems;
}

module.exports = { stripPageFurniture, textSimilarity, findTrailingBoilerplateStart, headingOf, nameTokens, nameSimilarity, carryCodes, segment, evaluateComponentSlice, derivedCode, slugOf, CARRY_THRESHOLD };
