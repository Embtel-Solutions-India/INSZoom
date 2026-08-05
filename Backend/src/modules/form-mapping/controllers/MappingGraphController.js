const MappingGraphService = require("../services/MappingGraphService");

function send(res, payload) {
  res.json({ success: true, ...payload });
}

exports.generate = async (req, res, next) => {
  try {
    const result = await MappingGraphService.generate(req.params.templateId, req.body || {}, req.user, req);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.validate = async (req, res, next) => {
  try {
    const result = await MappingGraphService.validate(req.params.templateId, req.body || {});
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.preview = async (req, res, next) => {
  try {
    const result = await MappingGraphService.preview(req.params.templateId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.search = async (req, res, next) => {
  try {
    const result = await MappingGraphService.search(req.params.templateId, req.query || {});
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.compare = async (req, res, next) => {
  try {
    const result = await MappingGraphService.compare(req.params.templateId, req.params.otherTemplateId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.deleteMapping = async (req, res, next) => {
  try {
    const result = await MappingGraphService.deleteMapping(req.params.templateId, req.params.mappingId, req.user, req);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.upsertMapping = async (req, res, next) => {
  try {
    const result = await MappingGraphService.upsertMapping(req.params.templateId, req.body || {}, req.user, req);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.versions = async (req, res, next) => {
  try {
    const result = await MappingGraphService.versions(req.params.templateId);
    send(res, result);
  } catch (error) {
    next(error);
  }
};

exports.activate = async (req, res, next) => {
  try {
    const result = await MappingGraphService.activate(req.params.templateId, req.user, req);
    send(res, result);
  } catch (error) {
    next(error);
  }
};
