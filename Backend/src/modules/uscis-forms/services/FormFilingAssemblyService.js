// Phase 10 of the registry-wide USCIS forms closure work (Part C of the
// plan): the final filing PDF for a parent form (e.g. I-129) is ONE official
// master PDF with the core CaseForm's values AND every applicable sibling
// component CaseForm's values (e.g. I129_H, I129_H_1B_DATA) applied onto it
// together - never a merge of independently-rendered fragment PDFs, and
// never a component's page-range treated as its own filing artifact.
//
// Reuses the existing, unmodified single-CaseForm render pipeline
// (PDFRenderer.render / PDFFieldMapper.mapFields) exactly as-is - the only
// new step is collecting every sibling's filledData and merging it onto the
// core's before that pipeline ever runs, so from the renderer's point of
// view this looks like one ordinary, fully-filled CaseForm.
const merge = require("lodash/merge");
const CaseForm = require("../../../models/CaseForm");
const FormMappingService = require("../../form-mapping/services/FormMappingService");
const PDFRenderer = require("../../form-generation/services/PDFRenderer");

async function assembleFilingPdf(caseId, parentFormCode) {
  const coreCaseForm = await CaseForm.findOne({ caseId, formCode: parentFormCode, componentCode: null }).lean();
  if (!coreCaseForm) {
    const error = new Error(`No core CaseForm found for case ${caseId}, form ${parentFormCode} - nothing to assemble.`);
    error.status = 404;
    error.code = "CORE_CASEFORM_NOT_FOUND";
    throw error;
  }

  const siblingComponents = await CaseForm.find({ parentCaseFormId: coreCaseForm._id }).lean();

  // Deep merge, not a shallow Object.assign - filledData is a nested
  // structure (MappingResolver.setPath's dot-path writes can produce nested
  // objects, e.g. {beneficiary: {firstName: ...}}), so two components each
  // touching different leaves of the same nested branch (e.g. both writing
  // under "beneficiary") must combine rather than one wholly overwriting the
  // other. Components are provisioned to be field-disjoint (verified by
  // Phase 8's isolation test), so a genuine leaf-level collision here would
  // itself be a real defect worth exposing, not silently possible.
  const mergedFilledData = merge({}, coreCaseForm.filledData || {}, ...siblingComponents.map((c) => c.filledData || {}));

  const template = await FormMappingService.loadTemplate(parentFormCode);

  const syntheticCaseForm = { ...coreCaseForm, filledData: mergedFilledData, componentCode: null };
  const rendered = await PDFRenderer.render({ caseForm: syntheticCaseForm, template, watermark: null, flatten: false });

  return {
    buffer: rendered.buffer,
    renderReport: rendered.renderReport,
    coreCaseFormId: coreCaseForm._id,
    componentCaseFormIds: siblingComponents.map((c) => c._id),
    componentCodes: siblingComponents.map((c) => c.componentCode),
    templateId: template._id,
    templateVersion: template.version,
  };
}

module.exports = { assembleFilingPdf };
