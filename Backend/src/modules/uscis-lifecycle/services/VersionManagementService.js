const AuditLog = require("../../../models/AuditLog");
const CaseForm = require("../../../models/CaseForm");
const USCISFormTemplate = require("../../../models/USCISFormTemplate");
const notificationService = require("../../notifications/notification.service");
const { requireAcceptedEdition } = require("../../form-edition-policy/EditionPolicyEnforcer");
const logger = require("../../../utils/logger");

// Which certification checks are critical and which an admin may override with a written reason: the ONE table in form-release/certPolicy.js (Phase 3 CERT_CHECK_POLICY).
// No certification on record is never overridable: certify first. (Re-exported under the old names.)
const { CRITICAL_CERTIFICATION_CHECKS, certificationDecision } = require("../../form-release/certPolicy");
const ReleaseGate = require("../../form-release/ReleaseGate");

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
    // Phase 3: ONE structured release decision for the preconditions (approved, mapping active, not deprecated) and the certification (Phase 0: only a certified edition goes live,
    // or one whose NON-critical checks an admin overrides with a written, audited reason). Acceptance and the edition diff are enforced right below / by the mapping activation.
    const release = await ReleaseGate.evaluate(template, { req, deps: { policy: async () => ({ allowed: true, reasons: [] }), editionDiff: async () => ({ blocked: false }) } });
    if (!release.canPromote) throw Object.assign(new Error(release.error), { status: 409, statusCode: 409 });
    const certificationCheck = { override: release.override };
    // Release 0b-2: an edition becomes the live one only when USCIS's acceptance of THIS edition is on record (fail closed, nothing is changed before this
    // passes: the current live edition stays live). Deliberately not inside a try/catch that carries on.
    await requireAcceptedEdition(template, { entryPoint: "VersionManagementService.activate", actor: user });
    const impact = await this.impactAnalysis(versionId);
    // Phase 3 activation protocol (no transaction needed): the NEW edition goes live while the OLD one is still live (readers take the newest active edition, so there is
    // never a moment without a live form), the change is confirmed, and only then is the OLD one retired. The intent is saved WITH the activation, so a crash between the
    // steps is finished (or reverted if the gate no longer holds) by reconcilePromotions().
    const replaced = await USCISFormTemplate.find({ formCode: template.formCode, _id: { $ne: template._id }, status: "active" }).select("_id").lean();
    const replacedIds = replaced.map((item) => item._id);
    template.status = "active";
    template.officialStatus = "current";
    template.currentStatus = "active";
    template.activeFlag = true;
    template.activatedAt = new Date();
    template.lifecycle = {
      ...(template.lifecycle?.toObject?.() || template.lifecycle || {}), activatedBy: this.userId(user), impactAnalysis: impact,
      ...(certificationCheck.override ? { certificationOverride: { ...certificationCheck.override, by: this.userId(user), at: new Date() } } : {}),
      ...(replacedIds.length ? { promotionIntent: { newId: template._id, oldIds: replacedIds, step: "retiring_old", at: new Date(), by: this.userId(user) } } : {}),
    };
    await template.save();
    invalidateTemplateCache();
    await this.retireReplaced(template, replacedIds, user);
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
      logger.warn("uscis_component_discovery_failed_after_activation", { formCode: template.formCode, error: discoveryError.message }); // Phase 7.0: no longer silent
      componentDiscovery = { parentFormCode: template.formCode, error: discoveryError.message, componentsDiscovered: 0 };
    }

    await this.audit("VERSION_ACTIVATED", template, user, req, { impact, componentDiscovery, ...(certificationCheck.override ? { certificationOverride: certificationCheck.override } : {}) });
    await this.notify(["super_admin", "admin", "case_manager", "attorney"], { title: "USCIS form version activated", message: `${template.formCode} ${template.version} is now active for new cases. Existing cases remain locked to prior editions.`, metadata: { versionId, impact } }, user, req);
    return { template, impact, componentDiscovery };
  }

  // Step 3 of the protocol: confirm the new edition is live, retire the ones it replaces, clear the intent. A failure here is NOT thrown (the new edition is live and the form
  // keeps serving); the intent stays on the template and reconcilePromotions() finishes it.
  static async retireReplaced(template, replacedIds, user) {
    if (!replacedIds.length) return { retired: 0 };
    try {
      const confirmed = await USCISFormTemplate.exists({ _id: template._id, status: "active" });
      if (!confirmed) throw new Error("the new edition is not active after the save");
      const result = await USCISFormTemplate.updateMany(
        { _id: { $in: replacedIds }, status: "active" },
        { $set: { status: "retired", currentStatus: "retired", activeFlag: false, retiredAt: new Date(), "lifecycle.retiredBy": this.userId(user) } }
      );
      await USCISFormTemplate.updateOne({ _id: template._id }, { $unset: { "lifecycle.promotionIntent": "" } });
      invalidateTemplateCache();
      return { retired: result.modifiedCount };
    } catch (error) {
      logger.warn("uscis_promotion_retire_deferred", { formCode: template.formCode, version: template.version, error: error.message });
      return { retired: 0, deferred: true, error: error.message };
    }
  }

  // Deterministic recovery of an interrupted promotion (run at start-up and on a timer). Every decision re-runs the edition-acceptance gate on the candidate and never
  // activates an edition the gate refuses, even to restore "one live edition". Returns one outcome per interrupted promotion.
  static async reconcilePromotions({ deps = {} } = {}) {
    const gate = deps.requireAccepted || requireAcceptedEdition;
    const pending = await USCISFormTemplate.find({ "lifecycle.promotionIntent.newId": { $exists: true } }).select("formCode version status editionDate importMetadata.editionDateSource lifecycle.promotionIntent").lean();
    const outcomes = [];
    for (const item of pending) {
      const intent = item.lifecycle.promotionIntent;
      const outcome = { formCode: item.formCode, version: item.version, templateId: String(item._id), outcome: "" };
      try {
        const olds = await USCISFormTemplate.find({ _id: { $in: intent.oldIds || [] } }).select("formCode version status editionDate importMetadata.editionDateSource").lean();
        const activeOlds = olds.filter((old) => old.status === "active");
        const clear = () => USCISFormTemplate.updateOne({ _id: item._id }, { $unset: { "lifecycle.promotionIntent": "" } });
        const retire = (ids, why) => USCISFormTemplate.updateMany({ _id: { $in: ids }, status: "active" }, { $set: { status: "retired", currentStatus: "retired", activeFlag: false, retiredAt: new Date(), "lifecycle.retiredWhy": why } });
        if (item.status === "active" && activeOlds.length) {
          let accepted = true;
          try { await gate(item, { entryPoint: "PromotionReconciler" }); } catch { accepted = false; }
          if (accepted) { await retire(activeOlds.map((old) => old._id), "replaced by the interrupted promotion"); outcome.outcome = "promotion_completed"; }
          else { await retire([item._id], "its edition acceptance no longer holds"); outcome.outcome = "new_edition_reverted_not_accepted"; }
          await clear();
        } else if (item.status === "active") {
          await clear(); outcome.outcome = "already_complete";
        } else if (activeOlds.length) {
          await clear(); outcome.outcome = "never_activated";
        } else {
          // neither edition is live: put the most recent previous edition back ONLY if the gate still accepts it
          const previous = [...olds].sort((a, b) => new Date(b.editionDate || 0) - new Date(a.editionDate || 0))[0];
          let restored = false;
          if (previous) {
            try {
              await gate(previous, { entryPoint: "PromotionReconciler" });
              await USCISFormTemplate.updateOne({ _id: previous._id }, { $set: { status: "active", currentStatus: "active", activeFlag: true } });
              restored = true;
            } catch { restored = false; }
          }
          outcome.outcome = restored ? "previous_edition_restored" : "no_policy_approved_edition_available";
          if (!restored) {
            logger.error("uscis_promotion_invariant_unsatisfied", { formCode: item.formCode });
            await this.notify(["super_admin", "admin"], { title: "No accepted " + item.formCode + " edition is live", message: "An interrupted promotion left " + item.formCode + " without a live edition, and no edition USCIS accepts could be restored. Form acquisition for it is paused until one is." }, null, null);
          }
          await clear();
        }
        if (outcome.outcome) invalidateTemplateCache();
      } catch (error) {
        outcome.outcome = "failed";
        outcome.error = error.message;
        logger.error("uscis_promotion_reconcile_failed", { formCode: item.formCode, error: error.message });
      }
      outcomes.push(outcome);
    }
    return outcomes;
  }

  // Rollback: put an earlier edition back as the live one. It goes through activate() - so the same certification, acceptance gate and activation protocol apply, and an edition
  // USCIS does not accept can never be restored. Cases are NOT moved back (answers entered since the migration would be lost); the case forms on the edition being replaced
  // are listed so an admin can reconcile them.
  static async rollback(formCode, { toTemplateId, reason } = {}, user, req) {
    const code = String(formCode || "").toUpperCase();
    const current = await USCISFormTemplate.findOne({ formCode: code, status: "active" }).select("_id version editionDate").lean();
    const candidates = await USCISFormTemplate.find({ formCode: code, status: "retired", ...(toTemplateId ? { _id: toTemplateId } : {}) }).select("_id version editionDate officialStatus importMetadata.validationSummary.certification activeMappingVersionId").lean();
    const target = candidates.filter((item) => item.officialStatus !== "deprecated" && item.importMetadata?.validationSummary?.certification?.passed === true).sort((a, b) => new Date(b.editionDate || 0) - new Date(a.editionDate || 0))[0];
    if (!target) throw Object.assign(new Error(toTemplateId ? "That edition cannot be restored: it is not a retired, certified edition of this form" : code + " has no earlier certified edition to roll back to"), { status: 409, statusCode: 409 });
    if (current && String(current._id) === String(target._id)) throw Object.assign(new Error("That edition is already the live one"), { status: 409, statusCode: 409 });
    const mappingOk = target.activeMappingVersionId && (await require("../../../models/USCISMappingVersion").exists({ _id: target.activeMappingVersionId }));
    if (!mappingOk) throw Object.assign(new Error("That edition's mapping version is no longer stored, so it cannot be restored"), { status: 409, statusCode: 409 });
    const result = await this.activate(target._id, user, req);
    const affected = current ? await CaseForm.find({ formTemplateId: current._id }).select("caseId status formCode").lean() : [];
    const report = { formCode: code, restored: { id: String(target._id), version: target.version }, replaced: current ? { id: String(current._id), version: current.version } : null, caseFormsToReconcile: affected.map((item) => ({ caseFormId: String(item._id), caseId: String(item.caseId), status: item.status })), reason: String(reason || "") };
    await this.audit("VERSION_ROLLED_BACK", result.template, user, req, { ...report, caseFormsToReconcile: affected.length });
    return { ...result, rollback: report };
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
