const AuditLog = require("../../../models/AuditLog");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const notificationService = require("../../notifications/notification.service");

class VersionManagementService {
  static userId(user) {
    return user?._id || user?.id || user;
  }

  static async audit(action, template, user, req, changes = {}) {
    await AuditLog.create({
      userId: this.userId(user),
      userRole: user?.role,
      action,
      entityType: "USCISFormTemplate",
      entityId: String(template._id),
      changes,
      ipAddress: req?.ip,
      userAgent: req?.headers?.["user-agent"],
      description: `${action} ${template.formCode} ${template.version}`,
    }).catch(() => null);
  }

  static async notify(roles, payload, user, req) {
    return notificationService.createForRoles(roles, { source: "shared", category: "system", type: "uscis_form_update", ...payload }, user, req).catch(() => []);
  }

  static async listForms(query = {}) {
    const match = {};
    if (query.status) match.status = query.status;
    if (query.provider) match["lifecycle.provider"] = query.provider;
    const forms = await USCISFormTemplate.find(match).sort({ formCode: 1, editionDate: -1, updatedAt: -1 });
    const dashboard = {
      total: forms.length,
      active: forms.filter((item) => item.status === "active").length,
      draft: forms.filter((item) => item.status === "draft").length,
      review: forms.filter((item) => item.status === "review").length,
      retired: forms.filter((item) => item.status === "retired").length,
      archived: forms.filter((item) => item.status === "archived").length,
      pendingReviews: forms.filter((item) => ["draft", "review"].includes(item.status)).length,
    };
    return { forms, dashboard };
  }

  static async versions(formType) {
    return USCISFormTemplate.find({ formCode: String(formType).toUpperCase() }).sort({ editionDate: -1, updatedAt: -1 });
  }

  static async impactAnalysis(templateId) {
    const template = await USCISFormTemplate.findById(templateId);
    if (!template) {
      const error = new Error("Form template version not found");
      error.status = 404;
      throw error;
    }
    const [activeCases, draftCases, pendingCases, approvedCases, completedCases] = await Promise.all([
      CaseForm.countDocuments({ formCode: template.formCode, status: { $in: ["pending", "draft", "ai_filled", "in_review", "under_review", "generated"] } }),
      CaseForm.countDocuments({ formCode: template.formCode, status: "draft" }),
      CaseForm.countDocuments({ formCode: template.formCode, status: { $in: ["pending", "ai_filled", "in_review", "under_review"] } }),
      CaseForm.countDocuments({ formCode: template.formCode, status: "approved" }),
      CaseForm.countDocuments({ formCode: template.formCode, status: { $in: ["approved", "locked"] } }),
    ]);
    return { formCode: template.formCode, futureCasesAffected: "new_cases_only", activeCasesUsingForm: activeCases, draftCases, pendingCases, approvedCases, completedCases };
  }

  static async approve(versionId, user, req) {
    const template = await USCISFormTemplate.findById(versionId);
    if (!template) throw Object.assign(new Error("Form version not found"), { status: 404 });
    template.status = "review";
    template.approvedBy = this.userId(user);
    template.approvedAt = new Date();
    template.lifecycle = { ...(template.lifecycle || {}), reviewRequestedAt: template.lifecycle?.reviewRequestedAt || new Date(), reviewNotes: req?.body?.notes };
    await template.save();
    await this.audit("VERSION_APPROVED_FOR_REVIEW", template, user, req);
    await this.notify(["super_admin", "admin"], { title: "USCIS version awaiting activation", message: `${template.formCode} ${template.version} is approved for activation review.`, metadata: { versionId } }, user, req);
    return template;
  }

  static async activate(versionId, user, req) {
    const template = await USCISFormTemplate.findById(versionId);
    if (!template) throw Object.assign(new Error("Form version not found"), { status: 404 });
    if (!template.approvedAt || !template.approvedBy) {
      throw Object.assign(new Error("Approve the USCIS form edition before activation"), { status: 409 });
    }
    if (template.mappingStatus !== "active") {
      throw Object.assign(new Error("Activate and validate the form mapping before activating this USCIS edition"), { status: 409 });
    }
    if (template.officialStatus === "deprecated") {
      throw Object.assign(new Error("A deprecated USCIS edition cannot be activated for new cases"), { status: 409 });
    }
    const impact = await this.impactAnalysis(versionId);
    await USCISFormTemplate.updateMany(
      { formCode: template.formCode, _id: { $ne: template._id }, status: "active" },
      { $set: { status: "retired", currentStatus: "retired", activeFlag: false, retiredAt: new Date(), "lifecycle.retiredBy": this.userId(user) } }
    );
    template.status = "active";
    template.officialStatus = "current";
    template.currentStatus = "active";
    template.activeFlag = true;
    template.activatedAt = new Date();
    template.lifecycle = { ...(template.lifecycle || {}), activatedBy: this.userId(user), impactAnalysis: impact };
    await template.save();
    await this.audit("VERSION_ACTIVATED", template, user, req, { impact });
    await this.notify(["super_admin", "admin", "case_manager", "attorney"], { title: "USCIS form version activated", message: `${template.formCode} ${template.version} is now active for new cases. Existing cases remain locked to prior editions.`, metadata: { versionId, impact } }, user, req);
    return { template, impact };
  }

  static async retire(versionId, user, req) {
    const template = await USCISFormTemplate.findById(versionId);
    if (!template) throw Object.assign(new Error("Form version not found"), { status: 404 });
    template.status = "retired";
    template.retiredAt = new Date();
    template.lifecycle = { ...(template.lifecycle || {}), retiredBy: this.userId(user) };
    await template.save();
    await this.audit("VERSION_RETIRED", template, user, req);
    await this.notify(["super_admin", "admin"], { title: "USCIS form version retired", message: `${template.formCode} ${template.version} was retired.`, metadata: { versionId } }, user, req);
    return template;
  }
}

module.exports = VersionManagementService;
