// Generic, metadata-driven resolution of which pages of a parent USCIS
// template belong to a given FORM_COMPONENT CaseForm - the single choke
// point every render/download/fidelity path goes through, so a component's
// page range can never silently be ignored in favor of rendering the full
// parent PDF. Resolves entirely from USCISFormComponentDefinition metadata
// (parentTemplateId + componentCode) - never branches on a specific
// formCode/componentCode, so it works identically for I-129's components,
// a future parent form's components, or any other registry-discovered
// FORM_COMPONENT.
const USCISFormComponentDefinition = require("../../../models/USCISFormComponentDefinition");

function componentPageError(message, details = {}) {
  const error = new Error(message);
  error.status = 422;
  error.code = "COMPONENT_PAGE_RESOLUTION_FAILED";
  error.details = details;
  return error;
}

// Expands validated pageRanges into a sorted, deduped, ascending list of
// 1-based page numbers - the same 1-based convention
// USCISFormComponentDiscoveryService discovered them in (pdf-parse's
// per-page text is indexed 1-based). Conversion to pdf-lib's 0-based page
// indices happens at exactly one controlled place - wherever this
// function's result is actually applied to a PDFDocument - never here and
// never duplicated per-caller.
function expandPageRanges(pageRanges, totalPages, context) {
  if (!Array.isArray(pageRanges) || pageRanges.length === 0) {
    throw componentPageError(
      `Component "${context.componentCode}" on parent ${context.parentFormCode} has no pageRanges defined - refusing to render/generate without explicit page metadata (never falls back to the full parent PDF).`,
      { ...context, pageRanges, totalPages }
    );
  }
  const pages = new Set();
  for (const range of pageRanges) {
    const start = Number(range?.startPage);
    const end = Number(range?.endPage);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw componentPageError(
        `Component "${context.componentCode}" on parent ${context.parentFormCode} has an invalid page range (startPage=${range?.startPage}, endPage=${range?.endPage}).`,
        { ...context, pageRanges, totalPages }
      );
    }
    if (end > totalPages) {
      throw componentPageError(
        `Component "${context.componentCode}" on parent ${context.parentFormCode} references page ${end}, but its parent PDF only has ${totalPages} pages.`,
        { ...context, pageRanges, totalPages }
      );
    }
    for (let p = start; p <= end; p += 1) pages.add(p);
  }
  return [...pages].sort((a, b) => a - b);
}

// Resolves a component CaseForm's real page list against its parent's
// CURRENT active template - live, never cached, mirroring exactly how
// visaFormMapping.service.js's resolveActiveComponent already resolves
// componentCode -> USCISFormComponentDefinition for provisioning/viewing
// (reused contract, not a second lookup convention). Returns null for a
// non-component CaseForm (no componentCode set) - callers must treat that
// as "render the full document," the existing, unchanged behavior for
// every independent form (I-539, I-140, I-485, etc.).
// Single shared DB lookup - used by resolveComponentPages below and by
// anything else (e.g. PDFFidelityService's expected-field-count check) that
// needs the same component definition, so there is exactly one query shape
// for "find this CaseForm's active component definition," never a second,
// possibly-diverging copy.
async function findActiveComponentDefinition(caseForm, template) {
  if (!caseForm?.componentCode) return null;
  const parentFormCode = caseForm.parentFormCode || template.formCode;
  const componentDef = await USCISFormComponentDefinition.findOne({
    parentTemplateId: template._id,
    componentCode: caseForm.componentCode,
    status: "ACTIVE",
  }).lean();
  if (!componentDef) {
    throw componentPageError(
      `No ACTIVE USCISFormComponentDefinition found for componentCode "${caseForm.componentCode}" against template ${parentFormCode} version ${template.version} - refusing to fall back to the full parent PDF.`,
      { parentFormCode, componentCode: caseForm.componentCode }
    );
  }
  return componentDef;
}

async function resolveComponentPages(caseForm, template, totalPages) {
  if (!caseForm?.componentCode) return null;
  const parentFormCode = caseForm.parentFormCode || template.formCode;
  const context = { parentFormCode, componentCode: caseForm.componentCode };
  const componentDef = await findActiveComponentDefinition(caseForm, template);
  return expandPageRanges(componentDef.pageRanges, totalPages, context);
}

// Computes which pages belong to the PARENT/CORE form itself - every page
// NOT claimed by any of its own currently-ACTIVE FORM_COMPONENT
// definitions. Returns null when the template has no active components at
// all (the ordinary case for every independent form - I-140, I-485,
// I-539, etc., and I-130 today since its only component definition is
// REVIEW_REQUIRED, not ACTIVE) - callers must treat null as "render every
// page," identical to the pre-Phase-2 behavior. Only when the template
// genuinely has one or more ACTIVE components does this return an
// explicit page list excluding them (Phase 2 add-on: componentCode=null
// no longer automatically means "render every page of the parent PDF" -
// it means "render the independent/core form's own pages").
async function resolveCorePages(template, totalPages) {
  const activeComponents = await USCISFormComponentDefinition.find({
    parentTemplateId: template._id,
    status: "ACTIVE",
  }).lean();
  if (!activeComponents.length) return null;

  const claimed = new Set();
  for (const def of activeComponents) {
    const context = { parentFormCode: def.parentFormCode, componentCode: def.componentCode };
    expandPageRanges(def.pageRanges, totalPages, context).forEach((p) => claimed.add(p));
  }

  const corePages = [];
  for (let p = 1; p <= totalPages; p += 1) {
    if (!claimed.has(p)) corePages.push(p);
  }
  if (!corePages.length) {
    throw componentPageError(
      `Parent template ${template.formCode} version ${template.version} has ${activeComponents.length} active component(s) claiming all ${totalPages} pages - no pages remain for the core/independent form. Refusing to render an empty core document.`,
      { parentFormCode: template.formCode, totalPages, claimedPages: [...claimed].sort((a, b) => a - b) }
    );
  }
  return corePages;
}

// Single entry point every render/download/fidelity path calls: resolves
// the exact page list to KEEP for a given CaseForm, whether it's a
// component (its own pageRanges) or a core/independent form (everything
// not claimed by one of its own active sibling components). Returns null
// only when no filtering is needed at all (independent form, zero
// registered ACTIVE components for its template) - the one signal callers
// use to skip page-removal entirely.
async function resolvePagesToKeep(caseForm, template, totalPages) {
  if (caseForm?.componentCode) {
    return resolveComponentPages(caseForm, template, totalPages);
  }
  return resolveCorePages(template, totalPages);
}

// Applies resolved 1-based page numbers to a live pdf-lib PDFDocument,
// removing every page not in the set (in descending index order, so
// removal never shifts not-yet-processed indices). Field values must
// already be written into the document before this runs - removing a page
// only drops that page's own content/widgets, never the AcroForm field
// definitions for fields that remain on kept pages.
function keepOnlyPages(pdfDocument, pages1Based) {
  const totalPages = pdfDocument.getPageCount();
  const keep = new Set(pages1Based.map((p) => p - 1)); // the one 1-based -> 0-based boundary
  for (let i = totalPages - 1; i >= 0; i -= 1) {
    if (!keep.has(i)) pdfDocument.removePage(i);
  }
}

module.exports = { resolveComponentPages, resolveCorePages, resolvePagesToKeep, expandPageRanges, keepOnlyPages, componentPageError, findActiveComponentDefinition };
