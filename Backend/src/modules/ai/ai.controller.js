const orchestration = require("./ai-orchestration.service");
const promptService = require("./ai-prompt.service");

function jobPayload(job) {
  return {
    id: job._id,
    jobType: job.jobType,
    status: job.status,
    caseId: job.caseId,
    output: job.output,
    confidence: job.confidence,
    citations: job.citations,
    suggestions: job.suggestions,
    review: job.review,
    usage: job.usage,
    error: job.error,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

async function run(req, res, next, jobType, payload = {}) {
  try {
    const background = req.body.background === true;
    const job = await orchestration.run(jobType, { ...req.body, ...payload }, req.user, req, background);
    res.status(background ? 202 : 200).json({ success: true, job: jobPayload(job) });
  } catch (error) {
    next(error);
  }
}

exports.copilot = (req, res, next) => run(req, res, next, "copilot", { caseId: req.params.caseId });
exports.caseReview = (req, res, next) => run(req, res, next, "case_review", { caseId: req.params.caseId });
exports.taskSuggestions = (req, res, next) => run(req, res, next, "task_suggestions", { caseId: req.params.caseId });
exports.semanticSearch = (req, res, next) => run(req, res, next, "semantic_search");

exports.listJobs = async (req, res, next) => {
  try {
    const jobs = await orchestration.listJobs(req.query, req.user);
    res.json({ success: true, count: jobs.length, jobs: jobs.map(jobPayload) });
  } catch (error) {
    next(error);
  }
};

exports.reviewJob = async (req, res, next) => {
  try {
    const job = await orchestration.review(req.params.id, req.body, req.user, req);
    res.json({ success: true, job: jobPayload(job) });
  } catch (error) {
    next(error);
  }
};

exports.applyTasks = async (req, res, next) => {
  try {
    const result = await orchestration.applyTaskSuggestions(req.params.id, req.body, req.user, req);
    res.status(201).json({ success: true, job: jobPayload(result.job), tasks: result.tasks });
  } catch (error) {
    next(error);
  }
};

exports.providers = async (req, res, next) => {
  try {
    const providers = await orchestration.listProviders(req.user);
    res.json({ success: true, providers });
  } catch (error) {
    next(error);
  }
};

exports.updateProvider = async (req, res, next) => {
  try {
    const provider = await orchestration.updateProvider(req.params.key, req.body, req.user);
    res.json({ success: true, provider });
  } catch (error) {
    next(error);
  }
};

exports.prompts = async (req, res, next) => {
  try {
    await promptService.ensureDefaults(req.user);
    const prompts = await promptService.list(req.query);
    res.json({ success: true, prompts });
  } catch (error) {
    next(error);
  }
};

exports.createPrompt = async (req, res, next) => {
  try {
    const prompt = await promptService.createVersion(req.body, req.user);
    res.status(201).json({ success: true, prompt });
  } catch (error) {
    next(error);
  }
};

exports.updatePrompt = async (req, res, next) => {
  try {
    const prompt = await promptService.update(req.params.id, req.body, req.user);
    res.json({ success: true, prompt });
  } catch (error) {
    next(error);
  }
};

exports.usage = async (req, res, next) => {
  try {
    const usage = await orchestration.usage(req.query);
    res.json({ success: true, usage });
  } catch (error) {
    next(error);
  }
};
