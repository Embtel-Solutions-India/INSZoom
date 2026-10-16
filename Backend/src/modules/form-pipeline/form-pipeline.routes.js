// Phase 1 visibility: the pipeline's job list and state (plan "Minimum visibility"). Exact-role guards (authorizeRoles), the same style as the edition-policy API.
//   GET  /api/form-pipeline/status            - mode, worker placement / liveness, counts per state
//   GET  /api/form-pipeline/jobs              - ?state=&formCode=&limit=
//   GET  /api/form-pipeline/jobs/:id          - one job: stages, failing stage, class and code, sanitized message, repairs and their verification, next retry, artifacts
//   POST /api/form-pipeline/jobs/:id/retry    - an admin puts a blocked / held / dead-letter job back in the queue
const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const FormPipelineJob = require("../../models/FormPipelineJob");
const { getService } = require("./FormPipelineJobService");
const { workerAlive } = require("./FormPipelineWorker");
const { mode } = require("./FormPipeline");
const { workerPlacement } = require("./index");
const { JOB_STATES } = require("./pipeline.constants");

const READ_ROLES = ["super_admin", "admin", "team_lead"];
const RETRY_ROLES = ["super_admin", "admin"];

const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

// a job as the API shows it: plain object, ids as strings, the lease token (a secret of the worker) never leaves the server
const present = (job) => {
  if (!job) return job;
  const { lease, __v, ...rest } = job;
  return { ...rest, _id: String(job._id), lease: lease ? { fence: lease.fence, lockedUntil: lease.lockedUntil, workerId: lease.workerId } : undefined };
};

router.use(authenticate);

router.get("/status", authorizeRoles(...READ_ROLES), handle(async () => {
  const counts = Object.fromEntries(Object.values(JOB_STATES).map((state) => [state, 0]));
  for (const row of await FormPipelineJob.aggregate([{ $group: { _id: "$state", n: { $sum: 1 } } }])) counts[row._id] = row.n;
  return { mode: mode(), worker: workerPlacement(), workerAlive: await workerAlive(), counts };
}));

router.get("/jobs", authorizeRoles(...READ_ROLES), handle(async (req) => {
  const state = req.query.state && Object.values(JOB_STATES).includes(String(req.query.state)) ? String(req.query.state) : undefined;
  return (await getService().list({ state, formCode: req.query.formCode, limit: req.query.limit })).map(present);
}));

router.get("/jobs/:id", authorizeRoles(...READ_ROLES), handle(async (req) => {
  const job = await getService().get(req.params.id).catch(() => null);
  if (!job) throw Object.assign(new Error("Pipeline job not found"), { status: 404 });
  return present(job);
}));

router.post("/jobs/:id/retry", authorizeRoles(...RETRY_ROLES), handle(async (req) => present(await getService().manualRetry(req.params.id, req.user))));

module.exports = router;
