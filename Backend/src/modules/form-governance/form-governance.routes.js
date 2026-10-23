// Phase 5 governance API: read-only views for the Admin screens. Exact-role guards (authorizeRoles), the same style as the pipeline and release APIs.
//   GET /api/form-governance/overview                  - pipeline mode / worker / counts / oldest stuck job / retries / stage timings, blocked + held jobs, recent runs, metrics
//   GET /api/form-governance/forms/:formCode/status    - per-stage statuses, pipeline timeline, lost edges, degraded / hold of one form
//   GET /api/form-governance/mapping-review            - ?formCode=  the mapping edges waiting for a person (read-only)
//   GET /api/form-governance/frozen-cases              - finalized / filed / locked case forms that stayed on an old edition
//   GET /api/form-governance/metrics                   - headline counts only
// Nothing here changes a form, a mapping, a job or a case; the only writes of the module are the run / migration summaries the recorders store.
const express = require("express");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");

const READ_ROLES = ["super_admin", "admin", "team_lead"];

const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

/** Builds the router; `services` is injectable so the HTTP layer can be tested without a database. */
function createRouter(services = {}) {
  const s = {
    overview: (...args) => require("./GovernanceOverviewService").overview(...args),
    metrics: (...args) => require("./GovernanceOverviewService").metrics(...args),
    formStatus: (...args) => require("./FormStatusService").formStatus(...args),
    mappingReview: (...args) => require("./MappingReviewService").mappingReviewQueue(...args),
    frozenCases: (...args) => require("./FrozenCasesService").frozenCases(...args),
    ...services,
  };
  const router = express.Router();
  router.use(authenticate);

  router.get("/overview", authorizeRoles(...READ_ROLES), handle(() => s.overview()));
  router.get("/metrics", authorizeRoles(...READ_ROLES), handle(() => s.metrics()));
  router.get("/forms/:formCode/status", authorizeRoles(...READ_ROLES), handle((req) => s.formStatus(String(req.params.formCode || "").slice(0, 40))));
  router.get("/mapping-review", authorizeRoles(...READ_ROLES), handle((req) => s.mappingReview({ formCode: req.query.formCode ? String(req.query.formCode).slice(0, 40) : undefined })));
  router.get("/frozen-cases", authorizeRoles(...READ_ROLES), handle(() => s.frozenCases()));
  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.READ_ROLES = READ_ROLES;
