const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const SavedCharge = require("../../models/SavedCharge");

router.use(authenticate, authorizePermissions("settings:manage_invoice"));

router.get("/", async (req, res, next) => {
  try {
    res.json({ success: true, data: await SavedCharge.find({}).sort({ name: 1 }) });
  } catch (error) { next(error); }
});

router.post("/", [body("name").trim().notEmpty(), body("amount").isFloat({ min: 0 })], validate, async (req, res, next) => {
  try {
    const charge = await SavedCharge.create({
      name: req.body.name, description: req.body.description || "", amount: req.body.amount,
      currency: req.body.currency || "USD", category: req.body.category || "", createdBy: req.user._id,
    });
    res.status(201).json({ success: true, data: charge });
  } catch (error) { next(error); }
});

router.patch("/:id", async (req, res, next) => {
  try {
    const charge = await SavedCharge.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true, runValidators: true });
    if (!charge) return res.status(404).json({ success: false, message: "Saved charge not found" });
    res.json({ success: true, data: charge });
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const result = await SavedCharge.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: "Saved charge not found" });
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
