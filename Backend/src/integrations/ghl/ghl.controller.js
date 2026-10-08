const env = require("../../config/env");
const sync = require("./ghlSyncService");
const webhookService = require("./ghlWebhookService");
const outbound = require("./ghlOutboundService");
const visaService = require("./ghlVisaService");
const boardService = require("./ghlBoardService");
const mongoose = require("mongoose");

// Every handler 503s when the integration is switched off, so the endpoints are
// inert (not erroring) in any environment that hasn't enabled GHL.
function guard(handler) {
  return async (req, res, next) => {
    if (!sync.isEnabled()) {
      return res.status(503).json({ success: false, code: "GHL_DISABLED", message: "GoHighLevel integration is not enabled" });
    }
    try {
      await handler(req, res);
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      next(error);
    }
  };
}

// Public endpoint: authenticity comes from the Ed25519 signature on the raw
// body (verified inside receiveWebhook), not from a login. req.body is a Buffer
// here because app.js mounts this route with express.raw BEFORE express.json.
exports.webhook = async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  let result;
  try {
    result = await webhookService.receiveWebhook(raw, req.headers);
  } catch (error) {
    require("../../utils/logger").error("ghl_webhook_unexpected_error", { error: error.message });
    return res.status(500).json({ success: false });
  }
  res.status(result.status).json(result.body);
  if (result.eventId) webhookService.processEventSoon(result.eventId);
};

// The status endpoint answers even when the integration is off (so the UI can
// decide whether to show the Pipeline page); it never 503s.
exports.status = async (req, res, next) => {
  try {
    res.json({ success: true, ...(await boardService.getStatus(req.user)) });
  } catch (error) {
    next(error);
  }
};

exports.board = guard(async (req, res) => {
  const { perColumn, column, skip, category } = req.query;
  res.json({
    success: true,
    ...(await boardService.getBoard(req.user, {
      perColumn,
      column: typeof column === "string" ? column : undefined,
      skip,
      category: typeof category === "string" ? category : undefined,
    })),
  });
});

// Drag-and-drop move. Saves locally and queues the GHL write, then answers
// immediately; GHL failures are retried in the background and never reach the UI.
exports.moveStage = guard(async (req, res) => {
  const { caseId } = req.params;
  const { unifiedStageKey, moveId } = req.body || {};
  if (!mongoose.isValidObjectId(caseId)) return res.status(400).json({ success: false, message: "Invalid case id" });
  if (typeof unifiedStageKey !== "string" || !unifiedStageKey.trim() || unifiedStageKey.length > 100) {
    return res.status(400).json({ success: false, message: "unifiedStageKey is required" });
  }
  const result = await outbound.moveCaseStage({
    caseId,
    unifiedStageKey: unifiedStageKey.trim(),
    moveId: typeof moveId === "string" ? moveId.slice(0, 64) : undefined,
    user: req.user,
  });
  res.json({ success: true, ...result });
});

exports.retryJob = guard(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ success: false, message: "Invalid job id" });
  res.json({ success: true, ...(await outbound.retryJob(req.params.id)) });
});

exports.visaMapping = guard(async (req, res) => {
  res.json({ success: true, ...(await visaService.getMappingView()) });
});

exports.saveVisaMapping = guard(async (req, res) => {
  try {
    res.json({ success: true, ...(await visaService.saveMapping(req.body?.entries)) });
  } catch (error) {
    if (error.code === "INVALID_MAPPING") return res.status(400).json({ success: false, message: error.message, errors: error.errors });
    throw error;
  }
});

exports.setupPreview = guard(async (req, res) => {
  res.json({ success: true, ...(await sync.previewSetup()) });
});

exports.confirmMappings = guard(async (req, res) => {
  const config = await sync.confirmMappings(req.user);
  res.json({ success: true, status: config.status, confirmedAt: config.mappingsConfirmedAt });
});

exports.syncNow = guard(async (req, res) => {
  const result = await sync.initialSync({ user: req.user });
  res.status(result.ok ? 200 : 409).json({ success: result.ok, ...result, emails: env.ghl.importSendsEmails ? "enabled" : "suppressed" });
});
