const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const importerService = require("../services/USCISFormImporterService");
const FormComparisonService = require("../../uscis-lifecycle/services/FormComparisonService");
const FormVersionService = require("../services/FormVersionService");

const versionService = new FormVersionService();

function statusOf(error) {
  return error.status || error.statusCode || 500;
}

function handle(res, error) {
  return res.status(statusOf(error)).json({
    success: false,
    message: error.message || "USCIS form import failed",
    code: error.code,
    details: error.details || [],
  });
}

exports.upload = async (req, res) => {
  try {
    const result = await importerService.importUpload(req.file, req.body, req.user, req);
    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      duplicate: result.duplicate,
      template: result.template,
      data: result.template,
      metadata: result.metadata,
      fieldCount: result.scanResult?.fieldCount || result.template?.formFields?.length || 0,
      comparisonReport: result.comparisonReport,
    });
  } catch (error) {
    handle(res, error);
  }
};

exports.importFromUrl = async (req, res) => {
  try {
    const result = await importerService.importFromUrl(req.body, req.user, req);
    res.status(result.duplicate ? 200 : 201).json({
      success: true,
      duplicate: result.duplicate,
      template: result.template,
      data: result.template,
      metadata: result.metadata,
      fieldCount: result.scanResult?.fieldCount || result.template?.formFields?.length || 0,
      comparisonReport: result.comparisonReport,
    });
  } catch (error) {
    handle(res, error);
  }
};

exports.list = async (req, res) => {
  try {
    const result = await importerService.list(req.query);
    res.json({ success: true, ...result, data: result });
  } catch (error) {
    handle(res, error);
  }
};

exports.get = async (req, res) => {
  try {
    const template = await importerService.get(req.params.id);
    res.json({ success: true, template, data: template });
  } catch (error) {
    handle(res, error);
  }
};

exports.fields = async (req, res) => {
  try {
    const template = await importerService.get(req.params.id);
    res.json({
      success: true,
      fields: template.formFields || [],
      sections: template.sections || [],
      pdfFieldMappings: template.pdfFieldMappings || [],
      data: {
        fields: template.formFields || [],
        sections: template.sections || [],
        pdfFieldMappings: template.pdfFieldMappings || [],
      },
    });
  } catch (error) {
    handle(res, error);
  }
};

exports.sections = async (req, res) => {
  try {
    const template = await importerService.get(req.params.id);
    const sections = template.formStructure?.sections || template.definition?.formStructure?.sections || template.sections || [];
    const groups = template.formStructure?.groups || template.definition?.groups || template.definition?.formStructure?.groups || [];
    res.json({ success: true, sections, groups, data: { sections, groups } });
  } catch (error) {
    handle(res, error);
  }
};

exports.layout = async (req, res) => {
  try {
    const template = await importerService.get(req.params.id);
    const layout = template.formLayout || template.definition?.layout || {};
    const pages = layout.pages || template.formStructure?.pages || template.definition?.pages || [];
    res.json({ success: true, layout, pages, data: { layout, pages } });
  } catch (error) {
    handle(res, error);
  }
};

exports.dependencies = async (req, res) => {
  try {
    const template = await importerService.get(req.params.id);
    const dependencies = template.fieldDependencies || template.definition?.dependencies || template.formStructure?.dependencies || [];
    res.json({ success: true, dependencies, data: dependencies });
  } catch (error) {
    handle(res, error);
  }
};

exports.validationRules = async (req, res) => {
  try {
    const template = await importerService.get(req.params.id);
    const validation = template.validationRules || template.definition?.validation || {};
    res.json({ success: true, validation, data: validation });
  } catch (error) {
    handle(res, error);
  }
};

exports.fieldMetadata = async (req, res) => {
  try {
    const template = await importerService.get(req.params.id);
    const field = (template.formFields || []).find((item) => (
      item.fieldId === req.params.fieldId ||
      item.fieldName === req.params.fieldId ||
      item.normalizedName === req.params.fieldId
    ));
    if (!field) return res.status(404).json({ success: false, message: "USCIS form field not found" });
    res.json({ success: true, field, data: field });
  } catch (error) {
    handle(res, error);
  }
};

exports.searchFields = async (req, res) => {
  try {
    const template = await importerService.get(req.params.id);
    const query = String(req.query.q || req.query.query || "").trim().toLowerCase();
    const type = req.query.type ? String(req.query.type).toLowerCase() : "";
    const section = req.query.section ? String(req.query.section).toLowerCase() : "";
    const page = req.query.page ? Number(req.query.page) : undefined;
    const fields = (template.formFields || []).filter((field) => {
      if (query) {
        const haystack = [
          field.searchableText,
          field.fieldId,
          field.fieldName,
          field.normalizedName,
          field.label,
          field.fieldLabel,
          field.sectionId,
        ].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (type && String(field.type || field.fieldType || "").toLowerCase() !== type) return false;
      if (section && String(field.sectionId || field.sectionKey || "").toLowerCase() !== section) return false;
      if (page && Number(field.pageNumber) !== page) return false;
      return true;
    });
    res.json({ success: true, fields, count: fields.length, data: { fields, count: fields.length } });
  } catch (error) {
    handle(res, error);
  }
};

exports.compare = async (req, res) => {
  try {
    const current = await USCISFormTemplate.findById(req.params.id);
    if (!current) return res.status(404).json({ success: false, message: "USCIS form template not found" });
    const previous = current.parentVersion
      ? await USCISFormTemplate.findById(current.parentVersion)
      : await USCISFormTemplate.findOne({ formCode: current.formCode, status: "active", _id: { $ne: current._id } }).sort({ editionDate: -1, updatedAt: -1 });
    if (!previous) return res.json({ success: true, comparisonReport: current.lifecycle?.comparisonReport || null, data: current.lifecycle?.comparisonReport || null });
    const report = FormComparisonService.compare(previous.toObject(), current.toObject());
    current.lifecycle = { ...(current.lifecycle || {}), comparisonReport: report, migrationSuggestions: report.migrationSuggestions || [] };
    await current.save();
    await importerService.audit("VERSION_COMPARED", current, req.user, req, report);
    res.json({ success: true, comparisonReport: report, data: report });
  } catch (error) {
    handle(res, error);
  }
};

exports.activate = async (req, res) => {
  try {
    const result = await versionService.activate(req.params.id, req.user, req);
    res.json({ success: true, ...result, data: result.template || result });
  } catch (error) {
    handle(res, error);
  }
};

exports.retire = async (req, res) => {
  try {
    const template = await versionService.retire(req.params.id, req.user, req);
    res.json({ success: true, template, data: template });
  } catch (error) {
    handle(res, error);
  }
};

exports.deleteDraft = async (req, res) => {
  try {
    const result = await versionService.deleteDraft(req.params.id, req.user, req);
    res.json({ success: true, ...result });
  } catch (error) {
    handle(res, error);
  }
};
