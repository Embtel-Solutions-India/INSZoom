const AuditLog = require("../../../models/AuditLog");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const notificationService = require("../../notifications/notification.service");
const { requireAcceptedEdition } = require("../../form-edition-policy/EditionPolicyEnforcer");
const logger = require("../../../utils/logger");

// Certification checks (FormCertificationService) whose failure always blocks activation. The others (viewer/download bytes, component slicing) may be
// overridden by an admin with a written reason, which is audited. No certification on record is never overridable: certify first.
const CRITICAL_CERTIFICATION_CHECKS = ["pdf_fillable", "mapping_valid", "fill_roundtrip"];
const OVERRIDE_REASON_MIN = 10;

/** Pure. { ok, error?, override? } - may this edition be activated given its stored certification report and the request. */
function certificationDecision(template, req) {
  const certification = template?.importMetadata?.validationSummary?.certification;
  if (!certification) return { ok: false, error: "This USCIS edition has not been certified yet; it is certified automatically on import, or re-run the certification before activating it" };
  if (certification.passed === true) return { ok: true };
  const failed = (certification.checks || []).filter((check) => !check.passed).map((check) => check.name);
  const critical = failed.filter((name) => CRITICAL_CERTIFICATION_CHECKS.includes(name) || !name);
  if (critical.length || !failed.length) return { ok: false, error: `Certification failed a critical check (${(critical.length ? critical : ["unknown"]).join(", ")}); this edition cannot be activated until it passes` };
  const reason = String(req?.body?.overrideReason || "").trim();
  if (reason.length < OVERRIDE_REASON_MIN) return { ok: false, error: `Certification failed non-critical check(s) (${failed.join(", ")}). Fix them, or activate with an overrideReason of at least ${OVERRIDE_REASON_MIN} characters (it is audited)` };
  return { ok: true, override: { reason, failed } };
}

// the template cache is read by case-form creation; whoever changes which edition is live must drop it (the lifecycle / import routes never did)
function invalidateTemplateCache() {
  try {
    require("../../uscis-forms/uscis-form.service").invalidateTemplateCache?.();
  } catch {
    // the cache simply expires on its own TTL
  }
}

class VersionManagementService {
  static userId(user) {
    return user?._id || user?.id || (user && typeof user === "object" && !user._bsontype ? undefined : user);
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
    }).catch((error) => { logger.warn("uscis_version_audit_failed", { action, formCode: template.formCode, version: template.version, error: error.message }); });
  }

  static async notify(roles, payload, user, req) {
    return notificationService.createForRoles(roles, { source: "shared", category: "system", type: "uscis_form_update", ...payload }, user, req).catch((error) => {
      logger.warn("uscis_version_notification_failed", { title: payload?.title, error: error.message });
      return [];
    });
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
    return { formCode: template.formCode, futureCasesAffected: "new_case_forms", openCaseForms: "stay_on_their_current_edition_until_migrated (the automatic pipeline migrates open forms with all saved answers; frozen forms are never migrated)", activeCasesUsingForm: activeCases, draftCases, pendingCases, approvedCases, completedCases };
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
    // Phase 0: only a certified edition goes live (or one whose NON-critical certification checks an admin overrides with a written, audited reason)
    const certificationCheck = certificationDecision(template, req);
    if (!certificationCheck.ok) throw Object.assign(new Error(certificationCheck.error), { status: 409, statusCode: 409 });
    // Release 0b-2: an edition becomes the live one only when USCIS's acceptance of THIS edition is on record (fail closed, nothing is changed before this
    // passes: the current live edition stays live). Deliberately not inside a try/catch that carries on.
    await requireAcceptedEdition(template, { entryPoint: "VersionManagementService.activate", actor: user });
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
    template.lifecycle = {
      ...(template.lifecycle || {}), activatedBy: this.userId(user), impactAnalysis: impact,
      ...(certificationCheck.override ? { certificationOverride: { ...certificationCheck.override, by: this.userId(user), at: new Date() } } : {}),
    };
    await template.save();
    invalidateTemplateCache();

    // A new edition can shift every downstream component's page range (a
    // page inserted/removed anywhere before a supplement moves it) - never
    // trust the previous edition's USCISFormComponentDefinition rows for the
    // template that is now active. Re-derive them from this edition's own
    // PDF text. Idempotent (discoverComponentsForParentForm upserts keyed on
    // {parentTemplateId, componentCode}) and registry-driven (reads
    // VisaFormMapping, not a hardcoded component list), so this is safe to
    // run on every activation, including one with no real component
    // boundary changes. Non-fatal: the version is already active by this
    // point, so a discovery failure here must not undo that - it only means
    // this edition's components stay whatever they were (or absent) until
    // someone re-runs discovery manually.
    let componentDiscovery = null;
    try {
      const USCISFormComponentDiscoveryService = require("../../uscis-forms/services/USCISFormComponentDiscoveryService");
      componentDiscovery = await USCISFormComponentDiscoveryService.discoverComponentsForParentForm(template.formCode);
    } catch (discoveryError) {
      componentDiscovery = { parentFormCode: template.formCode, error: discoveryError.message, componentsDiscovered: 0 };
    }

    await this.audit("VERSION_ACTIVATED", template, user, req, { impact, componentDiscovery, ...(certificationCheck.override ? { certificationOverride: certificationCheck.override } : {}) });
    await this.notify(["super_admin", "admin", "case_manager", "attorney"], { title: "USCIS form version activated", message: `${template.formCode} ${template.version} is now active for new cases. Existing cases remain locked to prior editions.`, metadata: { versionId, impact } }, user, req);
    return { template, impact, componentDiscovery };
  }

  static async retire(versionId, user, req) {
    const template = await USCISFormTemplate.findById(versionId);
    if (!template) throw Object.assign(new Error("Form version not found"), { status: 404, statusCode: 404 });
    // the ONE retire: every route (lifecycle, import, registry console) comes here, so status, currentStatus and activeFlag always agree
    template.status = "retired";
    template.currentStatus = "retired";
    template.activeFlag = false;
    template.retiredAt = new Date();
    template.lifecycle = { ...(template.lifecycle?.toObject?.() || template.lifecycle || {}), retiredBy: this.userId(user) };
    await template.save();
    invalidateTemplateCache();
    await this.audit("VERSION_RETIRED", template, user, req);
    await this.notify(["super_admin", "admin"], { title: "USCIS form version retired", message: `${template.formCode} ${template.version} was retired.`, metadata: { versionId } }, user, req);
    return template;
  }
}

module.exports = VersionManagementService;
module.exports.certificationDecision = certificationDecision;
module.exports.CRITICAL_CERTIFICATION_CHECKS = CRITICAL_CERTIFICATION_CHECKS;
