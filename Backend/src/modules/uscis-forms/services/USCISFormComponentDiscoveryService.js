// Discovers the real, embedded-page components ("classification
// supplements") a single-PDF parent USCIS form (I-129 today, generically
// any future parent) actually contains, by reading the exact, already-
// acquired-from-uscis.gov PDF stored for the parent's active
// USCISFormTemplate - never by hardcoding page numbers or heading text in
// source. Re-running this against a new template version (a new USCIS
// edition) produces fresh USCISFormComponentDefinition documents from that
// edition's real PDF; nothing here assumes a previous edition's numbers
// still apply.
//
// Registry-driven: the set of components to look for, and the search text
// used to find each one, comes from VisaFormMapping's own `formName` field
// for SUPPLEMENT/FORM_COMPONENT rows under a given parentForm - not a
// hand-authored list of components this file invents.
const VisaFormMapping = require("../../../models/VisaFormMapping");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");
const storageService = require("../../uploads/storage.service");
const { PDFParse } = require("pdf-parse");
const logger = require("../../../utils/logger");

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Derives a tolerant search pattern for a component purely from the
// registry's own formName - e.g. "O/P Classification Supplement to Form
// I-129" -> matches real printed headings like "O and P Classifications
// Supplement to Form I-129" even though the wording isn't byte-identical.
// Returns null if the formName doesn't look like a classification-style
// heading this pattern-derivation approach can handle (falls back to
// REVIEW_REQUIRED rather than guessing further).
function deriveSearchPattern(formName, parentFormCode) {
  const suffixPattern = new RegExp(`\\s+to\\s+Form\\s+${escapeRegex(parentFormCode)}\\s*$`, "i");
  const withoutSuffix = String(formName || "").replace(suffixPattern, "").trim();
  const codeMatch = withoutSuffix.match(/^([A-Za-z0-9/-]+)\s+(Classification|Data Collection)/i);
  if (codeMatch) {
    const code = codeMatch[1];
    // "/" in a classification code (e.g. "O/P") must also match the real
    // PDF's own "and" phrasing (e.g. "O and P") - the only wording
    // normalization applied, derived from the code itself, not hardcoded per
    // component. Split-and-rejoin rather than escapeRegex+unescape: "/" is
    // not a regex metacharacter in a `new RegExp(string)` source, so
    // escapeRegex never touches it - replacing it directly, before escaping
    // the surrounding literal parts, is the correct order.
    const codePattern = code.split("/").map(escapeRegex).join("(?:\\/|\\s+and\\s+)");
    return new RegExp(`\\b${codePattern}\\b[^.]{0,60}?(Classifications?\\s+Supplements?|Data\\s+Collection)`, "i");
  }
  // Generic fallback for a registry formName that doesn't follow the
  // "<Code> Classification/Data Collection Supplement" convention (e.g.
  // "Trade Agreement Supplement to Form I-129", confirmed live as the real
  // printed heading on I-129 p11 for E-3) - if it still reads as a genuine
  // heading (ends in "Supplement(s)"), search for that literal phrase
  // directly, rather than refusing every non-conventionally-named
  // component. Still registry-driven: the phrase comes from formName, not
  // hardcoded here.
  if (/Supplements?\s*$/i.test(withoutSuffix)) {
    return new RegExp(`\\b${escapeRegex(withoutSuffix)}\\b`, "i");
  }
  return null;
}

// A generic "does this look like the start of some other heading" detector
// - short, title-cased line ending in "Supplement(s)" near the top of a
// page's text - used only to flag ambiguity (a competing, uncaptured
// heading inside a component's provisional range), never to name what that
// other heading is. Deliberately not specific to any one form/component.
const HEADING_LIKE = /\b([A-Z][A-Za-z0-9\-/ ]{3,80}\bSupplements?\b)/;

async function extractPerPageText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result.pages.map((p) => p.text || "");
  } finally {
    await parser.destroy();
  }
}

// Trailing pages that are near-identical to each other (boilerplate closing
// sections - "Additional Information"/interpreter/preparer pages shared by
// every classification, not scoped to any one component) are detected by
// simple token-overlap similarity, not assumed to be a fixed count of pages.
function textSimilarity(a, b) {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (!tokensA.size || !tokensB.size) return 0;
  let shared = 0;
  for (const t of tokensA) if (tokensB.has(t)) shared += 1;
  return shared / Math.max(tokensA.size, tokensB.size);
}

function findTrailingBoilerplateStart(pages) {
  for (let i = pages.length - 1; i > 0; i -= 1) {
    if (textSimilarity(pages[i], pages[i - 1]) >= 0.6) continue;
    return i + 1; // 1-indexed page after the last dissimilar pair
  }
  return pages.length + 1; // no boilerplate tail detected
}

// Discovers every registry-referenced component for one parent form against
// its currently-active template, and upserts USCISFormComponentDefinition
// documents (one per component, keyed to this exact template version).
// Idempotent: re-running against the same active template version produces
// the same result, not duplicates.
async function discoverComponentsForParentForm(parentFormCode) {
  const componentMappings = await VisaFormMapping.find({
    parentForm: parentFormCode,
    componentType: { $in: ["SUPPLEMENT", "FORM_COMPONENT"] },
  }).select("formName componentType formTemplateFormCode").lean();

  const distinctByName = new Map();
  for (const row of componentMappings) {
    if (!distinctByName.has(row.formName)) distinctByName.set(row.formName, row);
  }

  const template = await USCISFormTemplate.findOne({ formCode: new RegExp(`^${escapeRegex(parentFormCode)}$`, "i"), status: "active" });
  if (!template) {
    return { parentFormCode, error: "NO_ACTIVE_PARENT_TEMPLATE", componentsDiscovered: 0 };
  }
  const storageKey = template.artifacts?.form?.storageKey;
  if (!storageKey) {
    return { parentFormCode, error: "NO_STORED_PDF", componentsDiscovered: 0 };
  }

  const buffer = await storageService.readBuffer(storageKey);
  const pages = await extractPerPageText(buffer);
  const boilerplateStart = findTrailingBoilerplateStart(pages);

  // Find every component's first-match page, skipping any formName the
  // pattern-derivation can't handle (left REVIEW_REQUIRED with a reason,
  // never guessed).
  const found = [];
  for (const [formName, row] of distinctByName) {
    const pattern = deriveSearchPattern(formName, parentFormCode);
    if (!pattern) {
      found.push({ formName, componentType: row.componentType, startPage: null, reviewReason: `Could not derive a search pattern from formName "${formName}" - needs a human-provided heading.` });
      continue;
    }
    // Match only in the heading region at the top of each page, not the
    // full page body - confirmed live across every one of I-129's real
    // component pages (9, 13, 21, 24, 28, 31, 32) that the printed heading
    // always sits within the first ~90 characters, right after the "Page N
    // of NN / Form ... Edition ..." header line. Matching the full page
    // body caused a real false positive: "Trade Agreement Supplement to
    // Form I-129" also appears as a plain cross-reference in Part 1's body
    // text on page 2, which is not that component's actual page.
    const HEADING_REGION_CHARS = 250;
    const matchPage = pages.findIndex((text) => pattern.test(text.slice(0, HEADING_REGION_CHARS))) + 1; // 1-indexed, 0 if none
    if (!matchPage) {
      found.push({ formName, componentType: row.componentType, startPage: null, reviewReason: `No page in the active ${parentFormCode} template (version ${template.version}) matched the derived heading pattern for "${formName}".` });
      continue;
    }
    found.push({ formName, componentType: row.componentType, startPage: matchPage });
  }

  found.sort((a, b) => (a.startPage || Infinity) - (b.startPage || Infinity));

  const results = [];
  for (let i = 0; i < found.length; i += 1) {
    const current = found[i];
    const componentCode = `${parentFormCode.replace(/[^A-Za-z0-9]/g, "")}_${(current.formName || "").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 24).toUpperCase()}`;
    if (!current.startPage) {
      results.push(await upsertDefinition({ parentFormCode, template, componentCode, formName: current.formName, componentType: current.componentType, pageRanges: [], fieldIds: [], status: "REVIEW_REQUIRED", reviewReason: current.reviewReason }));
      continue;
    }
    const nextStart = found[i + 1]?.startPage;
    const provisionalEnd = Math.min((nextStart ? nextStart - 1 : pages.length), boilerplateStart - 1);
    const endPage = Math.max(current.startPage, provisionalEnd);

    // Generic ambiguity check: does any page strictly AFTER this
    // component's own matched heading page, but still inside its
    // provisional range, contain ANOTHER heading-like "...Supplement" line
    // this component's own pattern didn't already match? If so, this
    // range likely actually contains more than one real component and
    // must not be auto-activated.
    const ownPattern = deriveSearchPattern(current.formName, parentFormCode);
    let competingHeadingPage = null;
    for (let p = current.startPage; p <= endPage; p += 1) {
      const text = pages[p - 1] || "";
      const headingMatch = text.match(HEADING_LIKE);
      if (!headingMatch) continue;
      if (ownPattern && ownPattern.test(headingMatch[0])) continue;
      if (p === current.startPage) continue; // the component's own heading line itself
      competingHeadingPage = p;
      break;
    }

    if (competingHeadingPage) {
      results.push(await upsertDefinition({
        parentFormCode, template, componentCode, formName: current.formName, componentType: current.componentType,
        pageRanges: [{ startPage: current.startPage, endPage }], fieldIds: [], status: "REVIEW_REQUIRED",
        reviewReason: `Page ${competingHeadingPage} (inside this component's provisional range ${current.startPage}-${endPage}) contains a distinct "...Supplement" heading this component's own search pattern did not match - this range likely spans more than one real component (e.g. multiple classifications sharing one registry formName) and must not be auto-activated.`,
      }));
      continue;
    }

    const fieldIds = (template.formFields || [])
      .filter((f) => f.pageNumber != null && f.pageNumber >= current.startPage && f.pageNumber <= endPage)
      .map((f) => f.fieldId || f.fieldName)
      .filter(Boolean);

    // Integrity check (independent of the filter above, so a real bug in
    // the filter itself can't silently hide a violation): every field just
    // selected must actually have pageNumber inside the range.
    const outOfRange = (template.formFields || []).filter((f) => fieldIds.includes(f.fieldId || f.fieldName) && !(f.pageNumber >= current.startPage && f.pageNumber <= endPage));
    if (outOfRange.length) {
      results.push(await upsertDefinition({
        parentFormCode, template, componentCode, formName: current.formName, componentType: current.componentType,
        pageRanges: [{ startPage: current.startPage, endPage }], fieldIds: [], status: "REVIEW_REQUIRED",
        reviewReason: `${outOfRange.length} field(s) failed the page-range integrity check (assigned to this component but pageNumber outside ${current.startPage}-${endPage}).`,
      }));
      continue;
    }

    const definition = await upsertDefinition({
      parentFormCode, template, componentCode, formName: current.formName, componentType: current.componentType,
      pageRanges: [{ startPage: current.startPage, endPage }], fieldIds, status: "ACTIVE", reviewReason: undefined,
    });
    results.push(definition);
  }

  // Connect every matching VisaFormMapping row's componentCode - only for
  // ACTIVE definitions, so a REVIEW_REQUIRED component (like E above) stays
  // fully excluded from resolution exactly as an unconnected one already
  // is, never half-wired. Matched by formName (the same key discovery
  // itself grouped rows by), so this connects every visa's row that shares
  // a given component, not just one.
  for (const definition of results) {
    if (definition.status !== "ACTIVE") continue;
    await VisaFormMapping.updateMany(
      { parentForm: parentFormCode, formName: definition.name },
      { $set: { componentCode: definition.componentCode } }
    );
  }

  return { parentFormCode, templateVersion: template.version, componentsDiscovered: results.length, results: results.map((r) => ({ componentCode: r.componentCode, status: r.status, pageRanges: r.pageRanges, fieldCount: r.fieldIds.length, reviewReason: r.reviewReason })) };
}

async function upsertDefinition({ parentFormCode, template, componentCode, formName, componentType, pageRanges, fieldIds, status, reviewReason }) {
  // findOneAndUpdate silently drops an `undefined` field from the update
  // instead of unsetting it - a re-run that goes from REVIEW_REQUIRED (with
  // a reason) to ACTIVE (no reason) would otherwise leave the previous
  // run's stale reviewReason sitting in the document. $unset explicitly
  // whenever there isn't a current reason, so the stored reason always
  // reflects this run, never a prior one.
  const update = {
    $set: {
      parentFormCode,
      parentTemplateId: template._id,
      templateVersion: template.version,
      componentCode,
      name: formName,
      componentType,
      pageRanges: pageRanges.length ? pageRanges : [{ startPage: 1, endPage: 1 }],
      fieldIds,
      status,
      discoverySource: "USCISFormComponentDiscoveryService",
      discoveredAt: new Date(),
      verificationMethod: "pdf_text_heading_search+field_page_crossref",
    },
  };
  if (reviewReason) update.$set.reviewReason = reviewReason;
  else update.$unset = { reviewReason: "" };
  const doc = await USCISFormComponentDefinition.findOneAndUpdate(
    { parentTemplateId: template._id, componentCode },
    update,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  // pageRanges above is written as a real, discovered range whenever one was
  // found; the [{1,1}] fallback only applies to the "no page matched at all"
  // REVIEW_REQUIRED case, where the schema's required-non-empty-array
  // constraint would otherwise reject the document - never used for an
  // ACTIVE result.
  return doc;
}

// Registry-driven: enumerates every distinct parentForm value that actually
// has SUPPLEMENT/FORM_COMPONENT rows in VisaFormMapping today, and runs
// discovery for each - not hardcoded to I-129.
async function discoverAllRegistryComponents() {
  const parentForms = await VisaFormMapping.distinct("parentForm", { componentType: { $in: ["SUPPLEMENT", "FORM_COMPONENT"] } });
  const results = [];
  for (const parentFormCode of parentForms) {
    if (!parentFormCode) continue;
    try {
      results.push(await discoverComponentsForParentForm(parentFormCode));
    } catch (error) {
      logger.error("uscis_component_discovery_failed", { parentFormCode, error: error.message });
      results.push({ parentFormCode, error: error.message, componentsDiscovered: 0 });
    }
  }
  return results;
}

module.exports = {
  discoverComponentsForParentForm,
  discoverAllRegistryComponents,
  deriveSearchPattern,
};
