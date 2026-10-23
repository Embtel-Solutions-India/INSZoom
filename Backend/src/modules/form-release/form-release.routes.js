// Phase 3 release API. Exact-role guards (authorizeRoles), the same style as the pipeline and edition-policy APIs.
//   GET  /api/form-release/templates/:id/gate                 the ReleaseGate's decision for one edition: promote | restricted_degraded | approval_required | held | blocked, with every check
//   GET  /api/form-release/forms/:formCode/migration-plan     dry run of moving the open case forms onto an edition (?templateId=, default the newest live/pending one): nothing is written
//   POST /api/form-release/forms/:formCode/rollback           { toTemplateId?, reason? } puts an earlier certified edition back (same certification + acceptance gates); cases are NOT moved back
//   POST /api/form-release/reconcile                          runs the recovery sweeps once (interrupted promotions, interrupted case-form migrations)
//   GET  /api/form-release/migration-snapshots?caseFormId=    pre-image METADATA only (never the client's answers)            admin only
//   POST /api/form-release/migration-snapshots/:id/restore    { dryRun? (default true) } restores a case form from its pre-image; never over a newer edit   admin only
// The pre-images hold client data, so reading / restoring them is exactly `admin` (no implicit super_admin or team_lead) and every restore is audited.
const router = require("express").Router();
const mongoose = require("mongoose");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");

const REVIEW_ROLES = ["super_admin", "admin", "team_lead"];
const CHANGE_ROLES = ["super_admin", "admin"];
const SNAPSHOT_ROLES = ["admin"];

const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};
const notFound = (message) => Object.assign(new Error(message), { status: 404 });
const validId = (value) => mongoose.Types.ObjectId.isValid(String(value || ""));
const USCISFormTemplate = () => require("../../models/USCISFormTemplate");
// A restore report lists what differs, and the engine's diff carries the stored VALUES (a client's answers). The browser only ever gets the field path and what kind of difference it is.
const redactChanges = (report) => (report && Array.isArray(report.changes)
  ? { ...report, changes: report.changes.map((change) => ({ path: change.path, kind: change.expected === null || change.expected === undefined ? "added" : change.actual === null || change.actual === undefined ? "removed" : "changed" })) }
  : report);

router.get("/templates/:id/gate", authenticate, authorizeRoles(...REVIEW_ROLES), handle(async (req) => {
  if (!validId(req.params.id)) throw notFound("Form edition not found");
  const template = await USCISFormTemplate().findById(req.params.id).select("formCode version editionDate status approvedAt approvedBy mappingStatus officialStatus parentVersion importMetadata lifecycle").lean();
  if (!template) throw notFound("Form edition not found");
  const gate = await require("./ReleaseGate").evaluate(template, { req });
  return { formCode: template.formCode, version: template.version, status: template.status, ...gate };
}));

router.get("/forms/:formCode/migration-plan", authenticate, authorizeRoles(...REVIEW_ROLES), handle(async (req) => {
  const formCode = String(req.params.formCode || "").toUpperCase();
  const filter = validId(req.query.templateId) ? { _id: req.query.templateId, formCode } : { formCode, status: { $in: ["active", "review", "draft"] } };
  const template = await USCISFormTemplate().findOne(filter).sort({ editionDate: -1, updatedAt: -1 });
  if (!template) throw notFound(`No ${formCode} edition found`);
  return require("../form-mapping/services/CaseFormEditionMigrationService").planMigration({ newTemplate: template });
}));

router.post("/forms/:formCode/rollback", authenticate, authorizeRoles(...CHANGE_ROLES), handle(async (req) => {
  const result = await require("../uscis-lifecycle/services/VersionManagementService").rollback(req.params.formCode, { toTemplateId: req.body?.toTemplateId, reason: req.body?.reason }, req.user, req);
  return result.rollback;
}));

router.post("/reconcile", authenticate, authorizeRoles(...CHANGE_ROLES), handle(async () => require("./index").runReconcileOnce()));

router.get("/migration-snapshots", authenticate, authorizeRoles(...SNAPSHOT_ROLES), handle(async (req) => {
  if (!validId(req.query.caseFormId)) throw Object.assign(new Error("caseFormId is required"), { status: 400 });
  const rows = await require("../../models/CaseFormMigrationSnapshot").find({ caseFormId: req.query.caseFormId }).select("-preImage -intermediateImage").sort({ createdAt: -1 }).limit(20).lean();
  return rows.map(({ __v, ...row }) => row);
}));

router.post("/migration-snapshots/:id/restore", authenticate, authorizeRoles(...SNAPSHOT_ROLES), handle(async (req) => {
  if (!validId(req.params.id)) throw notFound("Snapshot not found");
  return redactChanges(await require("../form-mapping/services/CaseFormEditionMigrationService").restoreCaseFormFromPreImage(req.params.id, { dryRun: req.body?.dryRun !== false, actor: req.user, reason: String(req.body?.reason || "restore requested by an admin") }));
}));

module.exports = router;
