// §4.9 Workflow & SLAs. Reads workflow.sla.* live from the settings engine
// (settings/registry/workflow.registry.js). Calendar-day math only in this
// pass (no date library is installed in this backend — confirmed by
// checking package.json — and workflow.sla.businessDaysOnly is not yet a
// registered setting, so this is plain Date arithmetic, not a business-day
// calendar).
const settingsEngine = require("./settingsEngine.service");
const Case = require("../../models/Case");

function addCalendarDays(from, days) {
  const result = new Date(from);
  result.setDate(result.getDate() + Number(days || 0));
  return result;
}

// Called once at case-creation time (case.controller.js's createCase) — a
// snapshot of whatever the SLA day-counts are AT THAT MOMENT, same as every
// other "computed at creation" field already on Case (e.g. assignedAgent).
// Changing the setting later only affects newly-created cases.
async function computeInitialSlaDueDates(from = new Date()) {
  const [intakeMaxDays, rfeResponseDays, docCollectionDays] = await Promise.all([
    settingsEngine.getEffective("workflow.sla.intakeMaxDays", {}),
    settingsEngine.getEffective("workflow.sla.rfeResponseDays", {}),
    settingsEngine.getEffective("workflow.sla.docCollectionDays", {}),
  ]);
  return {
    intake: addCalendarDays(from, intakeMaxDays),
    rfeResponse: addCalendarDays(from, rfeResponseDays),
    docCollection: addCalendarDays(from, docCollectionDays),
  };
}

function isPastDue(dueDates, now) {
  return Object.values(dueDates || {}).some((date) => date && date < now);
}
function isDueWithin(dueDates, threshold) {
  return Object.values(dueDates || {}).some((date) => date && date >= new Date() && date <= threshold);
}

// Daily sweep (see server.js's startSlaSweepMaintenance): promotes cases to
// "breached" once any SLA date has passed, or to "at_risk" once one is due
// within the next 24h (never demotes a case, e.g. from breached back to
// at_risk, and never re-processes an already-breached case).
async function runSlaSweep() {
  const now = new Date();
  const atRiskThreshold = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const candidates = await Case.find({
    slaStatus: { $ne: "breached" },
    $or: [
      { "slaDueDates.intake": { $lte: atRiskThreshold } },
      { "slaDueDates.rfeResponse": { $lte: atRiskThreshold } },
      { "slaDueDates.docCollection": { $lte: atRiskThreshold } },
    ],
  }).select("_id caseId caseNumber assignedCaseManager slaDueDates slaStatus");

  let breached = 0;
  let atRisk = 0;
  for (const caseDoc of candidates) {
    const nextStatus = isPastDue(caseDoc.slaDueDates, now)
      ? "breached"
      : isDueWithin(caseDoc.slaDueDates, atRiskThreshold)
        ? "at_risk"
        : caseDoc.slaStatus;
    if (nextStatus === caseDoc.slaStatus) continue;
    caseDoc.slaStatus = nextStatus;
    await caseDoc.save();
    if (nextStatus === "breached") breached += 1;
    else atRisk += 1;
    if (nextStatus === "breached" && caseDoc.assignedCaseManager) {
      // Lazy require — avoids a require-cycle with notification.service.js,
      // which itself doesn't depend on this module.
      require("../notifications/notification.service").createNotification({
        type: "workflow_sla_breached",
        userId: caseDoc.assignedCaseManager,
        caseId: caseDoc._id,
        title: "Case SLA breached",
        message: `Case ${caseDoc.caseNumber || caseDoc.caseId} has passed its SLA due date.`,
        priority: "high",
      }).catch(() => {});
    }
  }
  return { checked: candidates.length, breached, atRisk };
}

module.exports = { computeInitialSlaDueDates, runSlaSweep, addCalendarDays };
