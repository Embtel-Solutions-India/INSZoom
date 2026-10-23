// Phase 4, read-only. Nothing here changes a mapping, a suggestion or the mode (the mode is the FORM_AI_MAPPING setting of the server). Exact-role guards.
//   GET /api/form-ai-mapping/status                       the mode, counts per form and tier, how many were applied, and the accuracy gate's state when it exists
//   GET /api/form-ai-mapping/suggestions?formCode=&tier=  stored suggestions (form metadata only - no client data can be in them)
const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const { mode } = require("./mode");
const { mongoStore } = require("./suggestionStore");

const ROLES = ["super_admin", "admin", "team_lead"];
const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

async function gateState() {
  try {
    const gate = require("./accuracy/AiMappingGate");
    return typeof gate.status === "function" ? await gate.status() : null;
  } catch {
    return null; // the gate is not there (yet): nothing is open
  }
}

router.get("/status", authenticate, authorizeRoles(...ROLES), handle(async () => {
  const rows = await mongoStore.counts();
  const forms = {};
  for (const row of rows) {
    const form = (forms[row._id.formCode] ||= { auto_use: 0, needs_review: 0, rejected: 0, applied: 0 });
    form[row._id.tier] = row.count;
    form.applied += row.applied;
  }
  return { mode: mode(), forms, gate: await gateState() };
}));

router.get("/suggestions", authenticate, authorizeRoles(...ROLES), handle(async (req) => {
  const tier = ["auto_use", "needs_review", "rejected"].includes(req.query.tier) ? req.query.tier : undefined;
  const rows = await mongoStore.list({ formCode: req.query.formCode, tier, limit: req.query.limit });
  return rows.map(({ __v, ...row }) => row);
}));

module.exports = router;
