const router = require("express").Router();
const authenticate = require("../../middleware/authenticate");
const Case = require("../../models/Case");
const Document = require("../../models/Document");
const Message = require("../../models/Message");
const Payment = require("../../models/Payment");
const Client = require("../../models/Client");

router.get("/clients", authenticate, async (req, res, next) => {
  try {
    const clients = await Client.find({}).sort({ updatedAt: -1 }).limit(500).lean();
    res.json({ success: true, clients, data: clients });
  } catch (error) {
    next(error);
  }
});

router.get("/cases", authenticate, async (req, res, next) => {
  try {
    const cases = await Case.find({}).sort({ updatedAt: -1 }).limit(500).lean();
    res.json({ success: true, cases, data: cases });
  } catch (error) {
    next(error);
  }
});

router.get("/cases/:caseId/full", authenticate, async (req, res, next) => {
  try {
    const [caseRecord, documents, messages, payments] = await Promise.all([
      Case.findById(req.params.caseId).lean(),
      Document.find({ caseId: req.params.caseId }).lean(),
      Message.find({ caseId: req.params.caseId }).lean(),
      Payment.find({ $or: [{ caseId: req.params.caseId }, { case: req.params.caseId }] }).lean(),
    ]);
    if (!caseRecord) return res.status(404).json({ success: false, message: "Case not found" });
    res.json({ success: true, case: caseRecord, data: { case: caseRecord, documents, messages, payments } });
  } catch (error) {
    next(error);
  }
});

router.get("/documents/:caseId", authenticate, async (req, res, next) => {
  try {
    const documents = await Document.find({ caseId: req.params.caseId }).lean();
    res.json({ success: true, documents, data: documents });
  } catch (error) {
    next(error);
  }
});

router.get("/messages/:caseId", authenticate, async (req, res, next) => {
  try {
    const messages = await Message.find({ caseId: req.params.caseId }).sort({ createdAt: 1 }).lean();
    res.json({ success: true, messages, data: messages });
  } catch (error) {
    next(error);
  }
});

router.put("/cases/:caseId/status", authenticate, async (req, res, next) => {
  try {
    const item = await Case.findByIdAndUpdate(req.params.caseId, { status: req.body.status }, { new: true });
    res.json({ success: true, case: item, data: item });
  } catch (error) {
    next(error);
  }
});

router.post("/outbound/status", authenticate, (req, res) => res.json({ success: true, message: "Status sync accepted by shared backend" }));
router.post("/outbound/message", authenticate, (req, res) => res.json({ success: true, message: "Message sync accepted by shared backend" }));
router.post("/outbound/document-review", authenticate, (req, res) => res.json({ success: true, message: "Document review sync accepted by shared backend" }));
router.post("/pull/cases", authenticate, (req, res) => res.json({ success: true, message: "Cases are already available in shared backend" }));
router.get("/pull/case/:id", authenticate, async (req, res, next) => {
  try {
    const item = await Case.findById(req.params.id).lean();
    res.json({ success: true, case: item, data: item });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
