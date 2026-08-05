const telemetryService = require("./telemetry.service");

async function trackEvent(req, res) {
  // Always 202 regardless of outcome — never leak the allow-list or let a
  // telemetry hiccup surface as an error to the public quiz/marketing caller.
  telemetryService.track({
    ...(req.body || {}),
    ip: req.ip,
  }).catch(() => {});
  res.status(202).json({ success: true });
}

async function summary(req, res, next) {
  try {
    const data = await telemetryService.query(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { trackEvent, summary };
