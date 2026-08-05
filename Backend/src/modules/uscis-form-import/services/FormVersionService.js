const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const FormComparisonService = require("../../uscis-lifecycle/services/FormComparisonService");
const VersionManagementService = require("../../uscis-lifecycle/services/VersionManagementService");

class FormVersionService {
  async resolveParent(formCode) {
    return USCISFormTemplate.findOne({ formCode, status: "active" }).sort({ editionDate: -1, updatedAt: -1 });
  }

  async createTemplate(payload, user, req) {
    const parent = payload.parentVersion ? await USCISFormTemplate.findById(payload.parentVersion) : await this.resolveParent(payload.formCode);
    const template = await USCISFormTemplate.create({
      ...payload,
      parentVersion: payload.parentVersion || parent?._id,
      status: payload.status || "draft",
      createdBy: user?._id,
      importedAt: new Date(),
    });
    let comparisonReport = null;
    if (parent) {
      comparisonReport = FormComparisonService.compare(parent.toObject(), template.toObject());
      template.lifecycle = {
        ...(template.lifecycle || {}),
        comparisonReport,
        migrationSuggestions: comparisonReport.migrationSuggestions || [],
      };
      await template.save();
      await VersionManagementService.audit("VERSION_COMPARED", template, user, req, comparisonReport);
    }
    await VersionManagementService.audit("VERSION_CREATED", template, user, req, {
      formCode: template.formCode,
      version: template.version,
      parentVersion: template.parentVersion,
      fieldCount: template.formFields?.length || 0,
    });
    return { template, parent, comparisonReport };
  }

  async activate(templateId, user, req) {
    return VersionManagementService.activate(templateId, user, req);
  }

  async retire(templateId, user, req) {
    return VersionManagementService.retire(templateId, user, req);
  }

  async deleteDraft(templateId, user, req) {
    const template = await USCISFormTemplate.findById(templateId);
    if (!template) {
      const error = new Error("USCIS form template not found");
      error.status = 404;
      throw error;
    }
    if (!["draft", "review", "pending_review"].includes(template.status)) {
      const error = new Error("Only draft or review form versions can be deleted");
      error.status = 409;
      throw error;
    }
    await VersionManagementService.audit("DRAFT_VERSION_DELETED", template, user, req, { formCode: template.formCode, version: template.version });
    await template.deleteOne();
    return { deleted: true, templateId };
  }
}

module.exports = FormVersionService;
