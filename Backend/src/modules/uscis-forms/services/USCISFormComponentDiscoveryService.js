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
const autonomy = require("../../../config/formPipelineAutonomy");
const Segmenter = require("./ComponentSegmenter");
const { stripPageFurniture, textSimilarity, findTrailingBoilerplateStart } = Segmenter;

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

// stripPageFurniture / textSimilarity / findTrailingBoilerplateStart: unchanged, now defined once in ComponentSegmenter (pure) and re-exported below.

// Discovers every registry-referenced component for one parent form against
// its currently-active template, and upserts USCISFormComponentDefinition
// documents (one per component, keyed to this exact template version).
// Idempotent: re-running against the same active template version produces
// the same result, not duplicates.
// options.templateId: discover against that specific (not yet active) edition - a pre-activation readiness check. Registry rows are only wired
// to the components when discovery ran against the ACTIVE edition.
async function discoverComponentsForParentForm(parentFormCode, options = {}) {
  const componentMappings = await VisaFormMapping.find({
    parentForm: parentFormCode,
    componentType: { $in: ["SUPPLEMENT", "FORM_COMPONENT"] },
  }).select("formName componentType formTemplateFormCode componentCode").lean();

  const distinctByName = new Map();
  for (const row of componentMappings) {
    if (!distinctByName.has(row.formName)) distinctByName.set(row.formName, row);
  }

  const template = options.templateId
    ? await USCISFormTemplate.findById(options.templateId)
    : await USCISFormTemplate.findOne({ formCode: new RegExp(`^${escapeRegex(parentFormCode)}$`, "i"), status: "active" });
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

  // Phase 7.5 (FORM_PIPELINE_AUTONOMY): the registry-free segmentation of the same PDF. off = not computed at all (today's behavior byte for byte); shadow = computed and only
  // LOGGED against today's result; on = additionally bounds every range by every real heading and records unregistered supplements as new-component candidates.
  const mode = autonomy.mode();
  let segmentation = null;
  let previousDefs = [];
  if (mode !== "off") {
    try {
      previousDefs = await loadPreviousDefinitions(parentFormCode, template);
      const registryCandidates = [...distinctByName.values()].map((row) => ({ name: row.formName, componentCode: row.componentCode || componentCodeFor(parentFormCode, row.formName), inUse: Boolean(row.componentCode), source: "registry" }));
      const previousCandidates = previousDefs.map((def) => ({ name: def.name, componentCode: def.componentCode, inUse: false, source: "previous" }));
      segmentation = Segmenter.segment({ pages, parentFormCode, candidates: [...registryCandidates, ...previousCandidates] });
    } catch (error) {
      logger.warn("uscis_component_segmentation_failed", { parentFormCode, error: error.message });
    }
  }

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

  // Phase 7.5 (on): a heading the registry knows nothing about becomes its own NEW-COMPONENT CANDIDATE (never ACTIVE) and ENDS the previous component's range, instead of
  // being silently absorbed into it. Registry components are unchanged: a start page they found is never touched.
  if (mode === "on" && segmentation) {
    const known = new Set(found.map((item) => item.startPage).filter(Boolean));
    for (const seg of segmentation.segments) {
      if (seg.kind !== "component" || seg.headingless || known.has(seg.startPage)) continue;
      found.push({ formName: seg.headingText, componentType: "FORM_COMPONENT", startPage: seg.startPage, candidate: { code: seg.componentCode, carried: seg.codeSource === "carried" } });
    }
  }

  found.sort((a, b) => (a.startPage || Infinity) - (b.startPage || Infinity));

  const results = [];
  for (let i = 0; i < found.length; i += 1) {
    const current = found[i];
    // a registry component keeps the code derived from its registry name (today's rule); in "on" a code the previous edition already used for that name wins, so a renamed
    // registry entry can never orphan the codes stored on registry rows and open case forms
    const componentCode = current.candidate ? current.candidate.code : (mode === "on" ? previousCodeFor(previousDefs, current.formName) : null) || componentCodeFor(parentFormCode, current.formName);
    if (current.candidate) {
      const nextStartCandidate = found[i + 1]?.startPage;
      const candidateEnd = Math.max(current.startPage, Math.min(nextStartCandidate ? nextStartCandidate - 1 : pages.length, boilerplateStart - 1));
      results.push(await upsertDefinition({
        parentFormCode, template, componentCode, formName: current.formName, componentType: current.componentType,
        pageRanges: [{ startPage: current.startPage, endPage: candidateEnd }], fieldIds: [], status: "REVIEW_REQUIRED",
        verificationMethod: CANDIDATE_METHOD,
        reviewReason: `New component candidate: pages ${current.startPage}-${candidateEnd} start with the heading "${current.formName}", which no registry row and no earlier edition accounts for. It is kept out of the core form's pages; register it (or confirm it) to use it.`,
      }));
      continue;
    }
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

  // Continuation sheets that no visa "requires" (e.g. I-129 Part 9 Additional Beneficiary Information, registered once by
  // scripts/registerI129AdditionalBeneficiaryComponent.js) were never re-created for a new edition. Re-derive each such component the same way
  // that script does: it is the trailing run of pages after the last page claimed by an ACTIVE component of THIS edition.
  const manualDefinitions = await USCISFormComponentDefinition.find({ parentFormCode, parentTemplateId: { $ne: template._id }, verificationMethod: "manual_registration_not_visa_driven" }).lean();
  for (const manual of Object.values(Object.fromEntries(manualDefinitions.map((item) => [item.componentCode, item])))) {
    const lastClaimedPage = results.filter((item) => item.status === "ACTIVE").reduce((max, item) => Math.max(max, ...(item.pageRanges || []).map((range) => range.endPage)), 0);
    const startPage = lastClaimedPage + 1;
    if (startPage > pages.length) continue;
    // sanity: the trailing pages must still look like the same sheet - compare their text with the same sheet of the edition it was registered on
    let looksSame = false;
    try {
      const oldTemplate = await USCISFormTemplate.findById(manual.parentTemplateId);
      const oldPages = await extractPerPageText(await storageService.readBuffer(oldTemplate.artifacts.form.storageKey));
      const oldRange = manual.pageRanges?.[0];
      const oldText = oldPages.slice((oldRange?.startPage || 1) - 1, oldRange?.endPage || oldPages.length).join(" ");
      const newText = stripPageFurniture(pages.slice(startPage - 1).join(" "));
      looksSame = textSimilarity(stripPageFurniture(oldText), newText) >= 0.7;
    } catch (error) {
      looksSame = false;
    }
    results.push(await upsertDefinition({
      parentFormCode, template, componentCode: manual.componentCode, formName: manual.name, componentType: manual.componentType,
      pageRanges: [{ startPage, endPage: pages.length }],
      fieldIds: (template.formFields || []).filter((f) => f.pageNumber != null && f.pageNumber >= startPage && f.pageNumber <= pages.length).map((f) => f.fieldId || f.fieldName).filter(Boolean),
      status: looksSame ? "ACTIVE" : "REVIEW_REQUIRED",
      reviewReason: looksSame ? undefined : `Trailing pages ${startPage}-${pages.length} no longer look like "${manual.name}".`,
    }));
  }

  // Phase 7.5 (on): pages after the last component that nothing accounts for (no heading, no registered continuation sheet, no previous counterpart) are an UNCLAIMED RUN. They
  // become a candidate (kept out of the core render) instead of silently leaking into the core form. Only for a parent that already has an ACTIVE component.
  if (mode === "on" && segmentation && results.some((item) => item.status === "ACTIVE")) {
    const covered = new Set();
    results.forEach((item) => (item.pageRanges || []).forEach((range) => { for (let p = range.startPage; p <= range.endPage; p += 1) covered.add(p); }));
    const tail = segmentation.segments.find((seg) => seg.kind === "tail");
    if (tail && !covered.has(tail.startPage)) {
      results.push(await upsertDefinition({
        parentFormCode, template, componentCode: `${parentFormCode.replace(/[^A-Za-z0-9]/g, "")}_UNCLAIMED_TAIL`, formName: `Unclaimed pages ${tail.startPage}-${tail.endPage}`, componentType: "FORM_COMPONENT",
        pageRanges: [{ startPage: tail.startPage, endPage: tail.endPage }], fieldIds: [], status: "REVIEW_REQUIRED", verificationMethod: CANDIDATE_METHOD,
        reviewReason: `Pages ${tail.startPage}-${tail.endPage} come after the last supplement and match no heading, no registered continuation sheet and nothing in the previous edition. They are kept out of the core form's pages until someone confirms what they are.`,
      }));
    }
  }

  // Phase 7.5 (shadow): what the segmentation says versus what today's discovery decided - logged only, nothing written
  if (mode === "shadow" && segmentation) {
    try {
      const today = results.map((item) => `${item.componentCode}:${item.status}:${(item.pageRanges || []).map((r) => `${r.startPage}-${r.endPage}`).join("+")}`).sort();
      const seen = segmentation.segments.filter((seg) => seg.kind !== "core").map((seg) => `${seg.kind}:${seg.componentCode || "-"}:${seg.startPage}-${seg.endPage}${seg.codeSource === "derived" ? ":candidate" : ""}`).sort();
      const registryStarts = new Set(found.map((item) => item.startPage).filter(Boolean));
      const unregistered = segmentation.segments.filter((seg) => seg.kind === "component" && !seg.headingless && !registryStarts.has(seg.startPage)).map((seg) => ({ startPage: seg.startPage, heading: seg.headingText }));
      logger.warn("uscis_component_segmentation_shadow", { parentFormCode, templateVersion: template.version, today, segmentation: seen, unregisteredHeadings: unregistered, unclaimedPages: segmentation.unclaimed });
    } catch (error) {
      logger.warn("uscis_component_segmentation_shadow_failed", { parentFormCode, error: error.message });
    }
  }

  // Connect every matching VisaFormMapping row's componentCode - only for
  // ACTIVE definitions, so a REVIEW_REQUIRED component (like E above) stays
  // fully excluded from resolution exactly as an unconnected one already
  // is, never half-wired. Matched by formName (the same key discovery
  // itself grouped rows by), so this connects every visa's row that shares
  // a given component, not just one.
  for (const definition of results) {
    if (definition.status !== "ACTIVE" || template.status !== "active") continue;
    await VisaFormMapping.updateMany(
      { parentForm: parentFormCode, formName: definition.name },
      { $set: { componentCode: definition.componentCode } }
    );
  }

  return { parentFormCode, templateVersion: template.version, componentsDiscovered: results.length, results: results.map((r) => ({ componentCode: r.componentCode, status: r.status, pageRanges: r.pageRanges, fieldCount: r.fieldIds.length, reviewReason: r.reviewReason, verificationMethod: r.verificationMethod })) };
}

const CANDIDATE_METHOD = "segmenter_new_component_candidate";
const componentCodeFor = (parentFormCode, formName) => `${parentFormCode.replace(/[^A-Za-z0-9]/g, "")}_${(formName || "").replace(/[^A-Za-z0-9]+/g, "_").slice(0, 24).toUpperCase()}`;

/** The most recent OTHER edition's definitions of this parent (any status), newest edition first. */
async function loadPreviousDefinitions(parentFormCode, template) {
  const defs = await USCISFormComponentDefinition.find({ parentFormCode, parentTemplateId: { $ne: template._id } }).select("parentTemplateId componentCode name status pageRanges verificationMethod discoveredAt").sort({ discoveredAt: -1 }).lean();
  if (!defs.length) return [];
  const newest = String(defs[0].parentTemplateId);
  return defs.filter((def) => String(def.parentTemplateId) === newest && def.verificationMethod !== CANDIDATE_METHOD);
}

/** A code the previous edition already used for this registry name: the same name exactly, or a renamed entry that is clearly the same component. null = derive it. */
function previousCodeFor(previousDefs, formName) {
  const exact = previousDefs.find((def) => def.name === formName);
  if (exact) return exact.componentCode;
  let best = null;
  for (const def of previousDefs) {
    const score = Segmenter.nameSimilarity(formName, def.name);
    if (score >= 0.85 && (!best || score > best.score)) best = { score, code: def.componentCode };
  }
  return best ? best.code : null;
}

async function upsertDefinition({ parentFormCode, template, componentCode, formName, componentType, pageRanges, fieldIds, status, reviewReason, verificationMethod = "pdf_text_heading_search+field_page_crossref" }) {
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
      verificationMethod,
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
  stripPageFurniture,
  textSimilarity,
  findTrailingBoilerplateStart,
  previousCodeFor,
};
