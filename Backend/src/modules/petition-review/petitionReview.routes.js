// Petition review API.
//   STAFF (case manager, team lead, admin, super admin - and they must have access to the case):
//     GET  /api/petition-review/cases/:caseId                                   petitions of the case with release state + latest feedback
//     POST /api/petition-review/cases/:caseId/documents/:documentId/attorney-review   { note? }  release to the attorney(s) + e-mail them
//     POST /api/petition-review/cases/:caseId/documents/:documentId/client-review     { note? }  release to the client-side audience + e-mail them
//   CLIENT PORTAL (the case's petition audience only: single person / petitioner / employer):
//     GET  /api/petition-review/client/petitions                                petitions released to me, with the latest 5 feedback messages each
//     GET  /api/petition-review/client/petitions/:documentId/file[?download=1]  the PDF (inline for the viewer, attachment for Download)
//   VIEWER (fast opening of a big PDF; see petitionViewToken.js):
//     POST /api/petition-review/documents/:documentId/view-link                a signed link for ONE petition and ONE person; starts reading the file in the background
//     GET  /api/petition-review/stream/:token/ready                            long-poll (about 12 s): { ready } once the file is in memory - the viewer just asks again, never an error
//     GET  /api/petition-review/stream/:token                                  the PDF, inline, with byte ranges (the viewer shows page 1 while the rest loads); access re-checked on every request
//   FEEDBACK THREAD (that audience and the case team):
//     GET  /api/petition-review/documents/:documentId/messages?limit=&before=
//     POST /api/petition-review/documents/:documentId/messages                  { body, clientMessageId? }
//     POST /api/petition-review/documents/:documentId/messages/read
// Someone outside the audience gets a 404 for a petition, never a hint that it exists.
const express = require("express");
const rateLimit = require("express-rate-limit");
const authenticate = require("../../middleware/authenticate");
const authorizeRoles = require("../../middleware/authorizeRoles");
const { createPetitionReviewService, MANAGER_ROLES } = require("./petitionReview.service");

// "bytes=a-b" | "bytes=a-" | "bytes=-n" -> { start, end } | null (no / unusable header: send everything) | false (cannot be satisfied)
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!suffix) return false;
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start >= size || start > end ? false : { start, end };
}

function createRouter(services = {}) {
  const service = services.service || createPetitionReviewService();
  const router = express.Router();
  // the viewer link is its own credential (a browser PDF viewer cannot send a header): these two routes sit before the sign-in guard
  const streamLimiter = rateLimit({ windowMs: 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
  router.get("/stream/:token/ready", streamLimiter, async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ success: true, data: await service.streamReady({ token: req.params.token, waitMs: services.waitMs }) });
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
      return next(error);
    }
  });
  router.get("/stream/:token", streamLimiter, async (req, res, next) => {
    try {
      const file = await service.streamFile({ token: req.params.token });
      const size = file.buffer.length;
      // this response is framed by the portals (other origins): allow exactly those, and nothing else
      res.removeHeader("X-Frame-Options");
      const origins = (services.frameOrigins || require("../../config/env").clientOrigins || []).filter(Boolean);
      res.setHeader("Content-Security-Policy", `frame-ancestors 'self' ${origins.join(" ")}`.trim());
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Content-Type", file.mimeType);
      const attachment = req.query.download === "1";
      res.setHeader("Content-Disposition", `${attachment ? "attachment" : "inline"}; filename="${encodeURIComponent(file.fileName)}"`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("ETag", file.etag);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (req.headers["if-none-match"] === file.etag) return res.status(304).end();
      const range = parseRange(req.headers.range, size);
      if (range === false) {
        res.setHeader("Content-Range", `bytes */${size}`);
        return res.status(416).end();
      }
      if (range) {
        res.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
        res.setHeader("Content-Length", range.end - range.start + 1);
        return res.status(206).end(file.buffer.subarray(range.start, range.end + 1));
      }
      res.setHeader("Content-Length", size);
      return res.status(200).end(file.buffer);
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
      return next(error);
    }
  });

  router.use(...(services.guard || [authenticate]));
  router.use(rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false }));

  const handle = (fn, status = 200) => async (req, res, next) => {
    try {
      res.status(status).json({ success: true, data: await fn(req) });
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
      return next(error);
    }
  };
  const managers = authorizeRoles(...MANAGER_ROLES);
  const note = (req) => (typeof req.body?.note === "string" ? req.body.note : "");

  router.get("/cases/:caseId", managers, handle((req) => service.listForStaff({ caseId: req.params.caseId, user: req.user })));
  router.post("/cases/:caseId/documents/:documentId/attorney-review", managers, handle((req) => service.sendForAttorneyReview({ caseId: req.params.caseId, documentId: req.params.documentId, actor: req.user, note: note(req), req }), 201));
  router.post("/cases/:caseId/documents/:documentId/client-review", managers, handle((req) => service.sendForClientReview({ caseId: req.params.caseId, documentId: req.params.documentId, actor: req.user, note: note(req), req }), 201));

  router.get("/client/petitions", handle((req) => service.listForClient({ user: req.user })));
  router.get("/client/petitions/:documentId/file", async (req, res, next) => {
    try {
      const file = await service.readFile({ user: req.user, documentId: req.params.documentId });
      const download = req.query.download === "1" || req.query.download === "true";
      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${encodeURIComponent(file.fileName)}"`);
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      return res.send(file.buffer);
    } catch (error) {
      if (error?.status) return res.status(error.status).json({ success: false, message: error.message });
      return next(error);
    }
  });

  router.post("/documents/:documentId/view-link", handle((req) => service.createViewLink({ user: req.user, documentId: req.params.documentId })));
  router.get("/documents/:documentId/messages", handle((req) => service.listMessages({ user: req.user, documentId: req.params.documentId, limit: req.query.limit, before: req.query.before })));
  router.post("/documents/:documentId/messages", handle((req) => service.postMessage({ user: req.user, documentId: req.params.documentId, body: req.body?.body, clientMessageId: req.body?.clientMessageId }), 201));
  router.post("/documents/:documentId/messages/read", handle((req) => service.markRead({ user: req.user, documentId: req.params.documentId })));
  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.parseRange = parseRange;
