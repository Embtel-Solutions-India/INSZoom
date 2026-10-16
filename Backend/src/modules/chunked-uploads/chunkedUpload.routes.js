const router = require("express").Router();
const express = require("express");
const authenticate = require("../../middleware/authenticate");
const service = require("./chunkedUpload.service");

// Any signed-in user may stage a file (Admin, client portal and attorney all attach files to chat messages). Staging grants nothing by itself:
// the file is private to the uploader and only becomes visible when a message the sender is allowed to post references it, and that
// message endpoint does its own role/case authorization.
const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, ...(await fn(req)) });
  } catch (error) {
    if (error.missingChunks) return res.status(error.status || 409).json({ success: false, message: error.message, code: error.code, missingChunks: error.missingChunks });
    next(error);
  }
};

router.post("/", authenticate, handle((req) => service.init({ userId: req.user._id, ...req.body })));
router.put(
  "/:uploadId/chunks/:index",
  authenticate,
  express.raw({ type: () => true, limit: service.CHUNK_BYTES + 1024 }),
  handle((req) => service.writeChunk({ userId: req.user._id, uploadId: req.params.uploadId, index: req.params.index, body: req.body }))
);
router.get("/:uploadId", authenticate, handle((req) => service.status({ userId: req.user._id, uploadId: req.params.uploadId })));
router.post("/:uploadId/complete", authenticate, handle((req) => service.complete({ userId: req.user._id, uploadId: req.params.uploadId })));
router.delete("/:uploadId", authenticate, handle(async (req) => { await service.abort({ userId: req.user._id, uploadId: req.params.uploadId }); return {}; }));

module.exports = router;
