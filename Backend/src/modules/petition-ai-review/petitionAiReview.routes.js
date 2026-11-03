// Petition AI Review API (Phase 4). STAFF only (super admin, admin, team lead, case manager) with access to the case:
//   GET  /api/petition-ai-review/cases/:caseId                                 the case's petitions with their latest scan (counts only)
//   GET  /api/petition-ai-review/scans/:scanId                                 one scan: status, summary, page -> issues, gaps, diagnostics
//   GET  /api/petition-ai-review/scans/:scanId/findings?page=&limit=&severity=&category=&fromPage=&toPage=   the findings, paged
//   POST /api/petition-ai-review/cases/:caseId/documents/:documentId/rescan    a fresh scan from page 1
//   POST /api/petition-ai-review/scans/:scanId/retry                           re-check a waiting scan now / reopen a failed or cancelled one
//   POST /api/petition-ai-review/scans/:scanId/cancel                          stop a running scan
// With PETITION_AI_REVIEW off the reads still answer (enabled: false, existing scans stay visible) and the actions answer 404 "switched off".
const express = require("express");
const rateLimit = require("express-rate-limit");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const { createReviewApi, STAFF_ROLES } = require("./reviewApi.service");

function createRouter(services = {}) {
  const api = services.api || createReviewApi();
  const router = express.Router();
  router.use(...(services.guard || [authenticate]));
  router.use(rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false }));
  router.use(services.roles || authorizeRoles(...STAFF_ROLES));

  const handle = (fn, status = 200) => async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.status(status).json({ success: true, data: await fn(req) });
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
      return next(error);
    }
  };

  router.get("/cases/:caseId", handle((req) => api.listForCase({ caseId: req.params.caseId, user: req.user })));
  router.get("/scans/:scanId", handle((req) => api.getScan({ scanId: req.params.scanId, user: req.user })));
  router.get("/scans/:scanId/findings", handle((req) => api.listFindings({ scanId: req.params.scanId, user: req.user, query: req.query })));
  router.post("/cases/:caseId/documents/:documentId/rescan", handle((req) => api.rescan({ caseId: req.params.caseId, documentId: req.params.documentId, user: req.user }), 201));
  router.post("/scans/:scanId/retry", handle((req) => api.retry({ scanId: req.params.scanId, user: req.user })));
  router.post("/scans/:scanId/cancel", handle((req) => api.cancel({ scanId: req.params.scanId, user: req.user })));
  return router;
}

const router = createRouter();
router.createRouter = createRouter;
module.exports = router;
