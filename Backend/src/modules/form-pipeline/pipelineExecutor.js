// The default executor of a pipeline job: the EXISTING import pipeline, unchanged. OnDemandFormAcquisitionService.ensureCurrentUSCISForm does the work
// (detect -> fetch/normalize/import -> map -> certify -> promote through the gate -> migrate cases); the context only lets it report each stage and prove the lease
// before it commits. Nothing about what the pipeline does is decided here.
const logger = require("../../utils/logger");

/** The user a background run acts as: whoever asked, else the oldest admin, else a system admin (the same fallback the 12-hour catalog sync already used). */
async function resolveActor(requestedBy, { User = require("../../models/User") } = {}) {
  try {
    if (requestedBy) {
      const user = await User.findById(requestedBy);
      if (user) return user;
    }
    const admin = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
    if (admin) return admin;
  } catch (error) {
    logger.warn("form_pipeline_actor_lookup_failed", { error: error.message });
  }
  return { role: "super_admin" };
}

function createDefaultExecutor({ acquisition = () => require("../uscis-form-import/services/OnDemandFormAcquisitionService"), actorFor = resolveActor } = {}) {
  return async function execute(job, context) {
    const user = context.actor || await actorFor(job.requestedBy);
    const req = context.req || { ip: "form-pipeline", headers: {}, requestId: `pipeline-${job._id}`, user };
    return acquisition().ensureCurrentUSCISForm(job.formCode, user, req, { forceCheck: Boolean(job.options?.forceCheck), pipeline: context });
  };
}

module.exports = { createDefaultExecutor, resolveActor };
