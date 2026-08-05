const routingService = require("./routing.service");

async function getOptions(req, res, next) {
  try {
    if (!req.query.leadId) return res.status(400).json({ success: false, message: "leadId is required" });
    const data = await routingService.getOptions(req.query.leadId, { languagePreference: req.query.language });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function book(req, res, next) {
  try {
    if (!req.body?.leadId) return res.status(400).json({ success: false, message: "leadId is required" });
    const data = await routingService.book(req.body.leadId, req.body, req);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function listQueue(req, res, next) {
  try {
    const data = await routingService.listQueue(req.query);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function claim(req, res, next) {
  try {
    const data = await routingService.claim(req.params.id, req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { getOptions, book, listQueue, claim };
