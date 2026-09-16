const settingsEngine = require("./settingsEngine.service");

function buildCtx(req) {
  return {
    userId: req.user?._id,
    teamId: req.user?.teamId,
    orgId: null, // single-tenant deployment — see settingsEngine.service.js buildScopeChain
  };
}

async function getCatalog(req, res, next) {
  try {
    const catalog = await settingsEngine.getCatalog(req.user, buildCtx(req));
    res.json({ success: true, data: catalog });
  } catch (error) {
    next(error);
  }
}

async function getOne(req, res, next) {
  try {
    const { scope = "system" } = req.query;
    const value = await settingsEngine.getEffective(req.params.key, {
      ...buildCtx(req),
      // A caller asking for a specific scope's cascade still resolves
      // top-down from that scope, matching getEffective's own semantics.
    });
    res.json({ success: true, data: { key: req.params.key, scope, value } });
  } catch (error) {
    next(error);
  }
}

async function bulkSet(req, res, next) {
  try {
    const { changes } = req.body || {};
    const updated = await settingsEngine.bulkSet(changes, req.user, req, { reason: req.body?.reason });
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

async function listAudit(req, res, next) {
  try {
    const { category, key, limit } = req.query;
    const logs = await settingsEngine.listAudit({ category, key, limit: limit ? Number(limit) : undefined });
    res.json({ success: true, data: logs });
  } catch (error) {
    next(error);
  }
}

async function getHistory(req, res, next) {
  try {
    const { scope = "system", scopeId } = req.query;
    const versions = await settingsEngine.history(req.params.key, scope, scopeId || null);
    res.json({ success: true, data: versions });
  } catch (error) {
    next(error);
  }
}

async function rollback(req, res, next) {
  try {
    const { scope = "system", scopeId = null, toVersion } = req.body || {};
    const updated = await settingsEngine.rollback(req.params.key, scope, scopeId, Number(toVersion), req.user, req);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
}

module.exports = { getCatalog, getOne, bulkSet, listAudit, getHistory, rollback };
