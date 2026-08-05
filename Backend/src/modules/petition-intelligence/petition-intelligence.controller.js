const service = require("./petition-intelligence.service");

exports.generate = async (req, res, next) => {
  try {
    const result = await service.generate(req.params.caseId, req.body || {}, req.user, req);
    res.status(201).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
};

exports.list = async (req, res, next) => {
  try {
    const artifacts = await service.list(req.params.caseId, req.user);
    res.json({ success: true, count: artifacts.length, artifacts });
  } catch (error) {
    next(error);
  }
};
