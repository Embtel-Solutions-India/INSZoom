const complianceService = require("./compliance.service");
const copyLintService = require("./copyLint.service");

async function getDisclaimer(req, res, next) {
  try {
    const data = await complianceService.getActiveDisclaimer();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function acceptDisclaimer(req, res, next) {
  try {
    const { context, sessionId, version } = req.body || {};
    if (!context) return res.status(400).json({ success: false, message: "context is required" });
    const acceptance = await complianceService.recordAcceptance({
      userId: req.user?._id,
      sessionId,
      context,
      version,
      req,
    });
    res.status(201).json({ success: true, data: acceptance });
  } catch (error) {
    next(error);
  }
}

async function lintCopy(req, res, next) {
  try {
    const { text } = req.body || {};
    if (typeof text !== "string") return res.status(400).json({ success: false, message: "text is required" });
    const result = await copyLintService.scan(text);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
}

module.exports = { getDisclaimer, acceptDisclaimer, lintCopy };
