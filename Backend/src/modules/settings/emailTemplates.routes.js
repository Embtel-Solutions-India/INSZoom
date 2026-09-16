const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const EmailTemplate = require("../../models/EmailTemplate");

router.use(authenticate);

router.get("/", authorizePermissions("settings:manage_email"), async (req, res, next) => {
  try {
    const templates = await EmailTemplate.find({}).sort({ updatedAt: -1 });
    res.json({ success: true, data: templates });
  } catch (error) { next(error); }
});

router.post(
  "/",
  authorizePermissions("settings:manage_email"),
  [body("name").trim().notEmpty(), body("subject").trim().notEmpty(), body("body").trim().notEmpty()],
  validate,
  async (req, res, next) => {
    try {
      const template = await EmailTemplate.create({
        name: req.body.name, subject: req.body.subject, body: req.body.body,
        category: req.body.category || "general", tags: req.body.tags || [],
        createdBy: req.user._id,
      });
      res.status(201).json({ success: true, data: template });
    } catch (error) { next(error); }
  }
);

router.get("/:id", authorizePermissions("settings:manage_email"), async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    res.json({ success: true, data: template });
  } catch (error) { next(error); }
});

router.patch("/:id", authorizePermissions("settings:manage_email"), async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    if (template.isSystem) {
      // System templates: only subject may be edited, never the body — the
      // rest of the app's transactional logic assumes the core body shape.
      if (req.body.subject) template.subject = req.body.subject;
    } else {
      if (req.body.name) template.name = req.body.name;
      if (req.body.subject) template.subject = req.body.subject;
      if (req.body.body) template.body = req.body.body;
      if (req.body.category) template.category = req.body.category;
      if (req.body.tags) template.tags = req.body.tags;
    }
    await template.save();
    res.json({ success: true, data: template });
  } catch (error) { next(error); }
});

router.delete("/:id", authorizePermissions("settings:manage_email"), async (req, res, next) => {
  try {
    const template = await EmailTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: "Template not found" });
    if (template.isSystem) return res.status(403).json({ success: false, message: "System templates cannot be deleted" });
    await template.deleteOne();
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
