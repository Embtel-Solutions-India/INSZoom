const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const Branch = require("../../models/Branch");

router.use(authenticate, authorizePermissions("settings:manage_users"));

router.get("/", async (req, res, next) => {
  try {
    res.json({ success: true, data: await Branch.find({}).sort({ name: 1 }) });
  } catch (error) { next(error); }
});

router.post("/", [body("name").trim().notEmpty()], validate, async (req, res, next) => {
  try {
    const branch = await Branch.create({ name: req.body.name, address: req.body.address || "", phone: req.body.phone || "" });
    res.status(201).json({ success: true, data: branch });
  } catch (error) { next(error); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const branch = await Branch.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    if (!branch) return res.status(404).json({ success: false, message: "Branch not found" });
    res.json({ success: true, data: branch });
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await Branch.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: "Branch not found" });
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
