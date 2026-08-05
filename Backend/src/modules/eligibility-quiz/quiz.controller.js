const quizService = require("./quiz.service");

async function getDefinition(req, res, next) {
  try {
    const data = await quizService.getDefinitionPayload({
      visaPathway: req.query.visa,
      sessionId: req.query.sessionId,
      req,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function getVisas(req, res, next) {
  try {
    res.json({ success: true, data: quizService.listVisaPathways() });
  } catch (error) {
    next(error);
  }
}

async function submit(req, res, next) {
  try {
    const data = await quizService.submit(req.body || {}, req);
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function listLeads(req, res, next) {
  try {
    const result = await quizService.listLeads(req.query);
    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function getLead(req, res, next) {
  try {
    const lead = await quizService.getLead(req.params.id);
    if (!lead) return res.status(404).json({ success: false, message: "Lead not found" });
    res.json({ success: true, data: lead });
  } catch (error) {
    next(error);
  }
}

async function markLeadSeen(req, res, next) {
  try {
    const data = await quizService.markLeadSeen(req.params.id, req.user);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function updateLeadStatus(req, res, next) {
  try {
    const data = await quizService.updateLeadStatus(req.params.id, req.body?.status, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function assignLead(req, res, next) {
  try {
    const data = await quizService.assignLead(req.params.id, req.body?.assignedTo, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function addLeadNote(req, res, next) {
  try {
    const data = await quizService.addLeadNote(req.params.id, req.body?.text, req.user, req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

module.exports = { getDefinition, getVisas, submit, listLeads, getLead, markLeadSeen, updateLeadStatus, assignLead, addLeadNote };
