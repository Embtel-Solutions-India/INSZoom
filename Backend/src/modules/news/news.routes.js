// USCIS News & Updates API.
//   PUBLIC, read-only (own rate limiter, short public cache) - what the Immiglance site shows:
//     GET /api/news?page=&limit=&q=&category=   paginated, searchable list (stored articles only)
//     GET /api/news/latest                       newest article's date, for "last updated" displays
//     GET /api/news/:slug                        one full article (404 when it does not exist or is not listed)
//   STAFF (authenticate + role guard, never public):
//     GET  /api/news/admin/status                runs, counts, settings
//     GET  /api/news/admin/failures              articles that failed or could not be preserved completely
//     POST /api/news/admin/sync                  start a synchronisation now ({ force: true } ignores conditional requests)
//     POST /api/news/admin/retry-failed          clear the back-off of failed / waiting articles and start a synchronisation
// Nothing here calls USCIS while answering a request; synchronisation is a background job (NewsSyncService).
const express = require("express");
const rateLimit = require("express-rate-limit");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const logger = require("../../utils/logger");

const STAFF_ROLES = ["super_admin", "admin", "team_lead"];

/** `services` is injectable so the HTTP layer can be tested without a database or the network. */
function createRouter(services = {}) {
  const s = {
    list: (...args) => require("./news.service").list(...args),
    latest: (...args) => require("./news.service").latest(...args),
    getBySlug: (...args) => require("./news.service").getBySlug(...args),
    status: (...args) => require("./news.admin.service").status(...args),
    failures: (...args) => require("./news.admin.service").failures(...args),
    isRunning: async () => (await require("../../utils/jobLock").runningJobs(["news-sync"])).length > 0,
    startSync: (options) => require("./news.job").syncService().runSync(options),
    resetFailed: () => require("./NewsRepository").createMongoRepository().resetFailed(),
    ...services,
  };

  const router = express.Router();
  const publicLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });
  const handle = (fn, { cache } = {}) => async (req, res, next) => {
    try {
      const data = await fn(req, res);
      if (res.headersSent) return undefined;
      if (cache) res.set("Cache-Control", cache);
      return res.json({ success: true, data });
    } catch (error) {
      return next(error);
    }
  };

  // ---- staff (registered first so "admin" can never be read as a slug) ----
  router.use("/admin", ...(services.adminGuard || [authenticate, authorizeRoles(...STAFF_ROLES)]));
  router.get("/admin/status", handle(() => s.status()));
  router.get("/admin/failures", handle((req) => s.failures(req.query.limit)));
  const startInBackground = async (res, options, beforeStart) => {
    if (await s.isRunning()) return res.status(409).json({ success: false, message: "A news synchronisation is already running." });
    const reset = beforeStart ? await beforeStart() : undefined;
    // a run lasts minutes (one request per 10 s, by the site's crawl-delay): answer now, report through /admin/status
    Promise.resolve(s.startSync(options)).catch((error) => logger.error("news_manual_sync_failed", { error: error?.message }));
    return res.status(202).json({ success: true, data: { started: true, ...(reset !== undefined ? { reset } : {}) } });
  };
  router.post("/admin/sync", async (req, res, next) => {
    try {
      await startInBackground(res, { trigger: "manual", force: req.body?.force === true, requestedBy: String(req.user?.email || req.user?.id || "").slice(0, 120) });
    } catch (error) {
      next(error);
    }
  });
  router.post("/admin/retry-failed", async (req, res, next) => {
    try {
      await startInBackground(res, { trigger: "manual", requestedBy: String(req.user?.email || req.user?.id || "").slice(0, 120) }, () => s.resetFailed());
    } catch (error) {
      next(error);
    }
  });

  // ---- public ----
  router.get("/", publicLimiter, handle((req) => s.list(req.query), { cache: "public, max-age=120" }));
  router.get("/latest", publicLimiter, handle(() => s.latest(), { cache: "public, max-age=120" }));
  router.get("/:slug", publicLimiter, async (req, res, next) => {
    try {
      const article = await s.getBySlug(req.params.slug);
      if (!article) return res.status(404).json({ success: false, message: "This news article was not found." });
      res.set("Cache-Control", "public, max-age=300");
      return res.json({ success: true, data: article });
    } catch (error) {
      return next(error);
    }
  });
  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.STAFF_ROLES = STAFF_ROLES;
