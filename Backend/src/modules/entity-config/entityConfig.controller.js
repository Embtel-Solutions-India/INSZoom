const entityConfigService = require("./entityConfig.service");

async function getPublicConfig(req, res, next) {
  try {
    const data = await entityConfigService.getPublicConfig();
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

async function getConfig(req, res, next) {
  try {
    const settings = await entityConfigService.getConfig();
    res.json({ success: true, data: settings });
  } catch (error) {
    next(error);
  }
}

async function updateConfig(req, res, next) {
  try {
    const updated = await entityConfigService.updateConfig(req.body || {}, req.user, req);
    res.json({ success: true, message: "Configuration updated", data: updated });
  } catch (error) {
    next(error);
  }
}

async function getStatusVocabulary(req, res, next) {
  try {
    res.json({ success: true, data: entityConfigService.getStatusVocabulary() });
  } catch (error) {
    next(error);
  }
}

module.exports = { getPublicConfig, getConfig, updateConfig, getStatusVocabulary };
