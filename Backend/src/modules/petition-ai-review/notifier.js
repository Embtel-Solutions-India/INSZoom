// Tells people about a petition scan (Petition AI Review, Phase 4). Never throws and is never awaited by the scan - a failed notification can never
// change or stop a scan; the result is stored regardless and the screen reads it when opened.
//   progress(scan, { pagesDone, lastPage }) - live event "petition:ai_review" to the case team, at most once per scan every `throttleMs` (2 s)
//   finished(scanId, outcome)                - live event to the case team and the person who started the scan, plus a bell notification to that
//                                              person when the scan reached an end state (completed / completed with gaps / failed / not set up)
const { SCAN_STATUS } = require("./constants");

const EVENT = "petition:ai_review";
const idOf = (value) => String(value?._id || value || "");
const BELL_STATES = new Set([SCAN_STATUS.COMPLETED, SCAN_STATUS.COMPLETED_WITH_GAPS, SCAN_STATUS.FAILED, SCAN_STATUS.NOT_CONFIGURED]);

function bellText(scan) {
  const name = scan.documentName || "the petition";
  const issues = (scan.counts?.error || 0) + (scan.counts?.warning || 0) + (scan.counts?.info || 0);
  if (scan.status === SCAN_STATUS.COMPLETED) return { title: "AI review finished", message: issues ? `${issues} issue${issues === 1 ? "" : "s"} found in ${name} (${scan.counts?.error || 0} to fix). AI-assisted - verify before acting.` : `No issues found in ${name}. AI-assisted - verify before acting.` };
  if (scan.status === SCAN_STATUS.COMPLETED_WITH_GAPS) return { title: "AI review finished (some pages unread)", message: `${issues} issue${issues === 1 ? "" : "s"} found in ${name}; some pages could not be read by the AI - check them by eye.` };
  if (scan.status === SCAN_STATUS.NOT_CONFIGURED) return { title: "AI review is not set up", message: `${name} was not scanned: no AI key is configured on the server.` };
  return { title: "AI review stopped", message: `${name}: ${scan.error?.message || "the scan could not finish"}` };
}

/** deps: { gateway(), notificationService(), Scan, getCase(caseId), teamIds(caseData), now(), throttleMs, logger } */
function createNotifier(deps = {}) {
  const logger = deps.logger || console;
  const now = deps.now || (() => Date.now());
  const throttleMs = deps.throttleMs ?? 2000;
  const gateway = deps.gateway || (() => require("../realtime/realtime.gateway"));
  const notificationService = deps.notificationService || (() => require("../notifications/notification.service"));
  const Scan = deps.Scan || require("../../models/PetitionAiScan");
  const getCase = deps.getCase || ((id) => require("../petition-review/petitionReview.data").getCase(id));
  const teamIds = deps.teamIds || ((row) => [...require("../cases/caseManagerAccess").allCaseManagerIds(row), row.assignedTeamLead, row.primaryOwner]);
  const lastSent = new Map(); // scanId -> time of the last progress event

  function emit(userIds, payload) {
    try {
      const live = gateway();
      new Set(userIds.map(idOf).filter(Boolean)).forEach((id) => live.emitToUser(id, EVENT, payload));
    } catch (error) {
      logger.error?.("petition_ai_review_emit_failed", { error: error?.message });
    }
  }

  async function recipientsOf(scan) {
    const caseData = await getCase(scan.caseId).catch(() => null);
    return { caseData, ids: caseData ? teamIds(caseData) : [] };
  }

  async function progress(scan, { pagesDone, lastPage } = {}) {
    try {
      const key = idOf(scan._id);
      const at = now();
      if (lastSent.has(key) && at - lastSent.get(key) < throttleMs) return false;
      lastSent.set(key, at);
      if (lastSent.size > 500) lastSent.delete(lastSent.keys().next().value);
      const { ids } = await recipientsOf(scan);
      emit(ids, { scanId: key, caseId: idOf(scan.caseId), documentId: idOf(scan.documentId), status: SCAN_STATUS.SCANNING, pagesDone, lastPage });
      return true;
    } catch (error) {
      logger.error?.("petition_ai_review_progress_failed", { error: error?.message });
      return false;
    }
  }

  async function finished(scanId, outcome = {}) {
    try {
      lastSent.delete(idOf(scanId));
      const scan = await Scan.findById(scanId).select("caseId documentId documentName status counts error requestedBy pagesDone lastPage").lean();
      if (!scan) return false;
      const { ids } = await recipientsOf(scan);
      emit([...ids, scan.requestedBy], { scanId: idOf(scan._id), caseId: idOf(scan.caseId), documentId: idOf(scan.documentId), status: scan.status, state: outcome.state, counts: scan.counts, pagesDone: scan.pagesDone, lastPage: scan.lastPage });
      if (scan.requestedBy && BELL_STATES.has(scan.status)) {
        const { title, message } = bellText(scan);
        await notificationService().createNotification({
          userId: scan.requestedBy,
          type: "general",
          category: "case",
          title,
          message,
          caseId: scan.caseId,
          link: `/crm-cases/${idOf(scan.caseId)}`,
          priority: scan.status === SCAN_STATUS.COMPLETED && !(scan.counts?.error) ? "low" : "medium",
          channels: ["in_app", "socket"],
          metadata: { petitionAiScanId: idOf(scan._id), documentId: idOf(scan.documentId), status: scan.status },
          source: "shared",
        }).catch((error) => logger.error?.("petition_ai_review_bell_failed", { error: error?.message }));
      }
      return true;
    } catch (error) {
      logger.error?.("petition_ai_review_finished_notify_failed", { error: error?.message });
      return false;
    }
  }

  return { progress, finished, EVENT };
}

module.exports = { createNotifier, bellText, EVENT };
