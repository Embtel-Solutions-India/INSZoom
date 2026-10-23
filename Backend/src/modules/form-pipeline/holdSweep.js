// Phase 7.0 housekeeping run by the worker on every tick (and nowhere else):
//   1. re-evaluate held / blocked jobs that were judged with older code versions (so a fix releases them without a click);
//   2. raise persistent holds once, after the escalation period (alert + the "persistent holds" list on the Operations screen).
// It never promotes anything and never changes a decision: a requeued job runs the normal pipeline and the same gates. Every step catches its own errors.
const logger = require("../../utils/logger");

function createHoldSweep({ jobService, alerter = null, log = logger, escalationLimit = 20 }) {
  return async function holdSweep() {
    const summary = { requeued: 0, escalated: 0 };
    try {
      summary.requeued = await jobService.requeueOutdatedHolds();
      if (summary.requeued) log.info("form_pipeline_holds_requeued", { count: summary.requeued });
    } catch (error) {
      log.warn("form_pipeline_hold_requeue_failed", { error: error.message });
    }
    try {
      const persistent = await jobService.persistentHolds({ limit: escalationLimit });
      for (const job of persistent) {
        const result = alerter?.announceEscalation ? await alerter.announceEscalation({ job }) : { sent: false };
        if (result?.sent) summary.escalated += 1;
        else if (!alerter?.announceEscalation) await jobService.markEscalated(job._id); // no alerter: still record that it was raised so it is not retried every tick
      }
      if (summary.escalated) log.warn("form_pipeline_holds_escalated", { count: summary.escalated });
    } catch (error) {
      log.warn("form_pipeline_hold_escalation_failed", { error: error.message });
    }
    // Phase 7.E: the "forms stuck" reminder (the alerter throttles itself and sends only when the set changed or the reminder time has passed); never throws
    if (typeof alerter?.sendStuckReminder === "function") {
      try {
        const reminded = await alerter.sendStuckReminder();
        summary.stuckReminded = reminded?.sent ? 1 : 0;
      } catch (error) {
        log.warn("form_pipeline_stuck_reminder_failed", { error: error.message });
      }
    }
    return summary;
  };
}

module.exports = { createHoldSweep };
