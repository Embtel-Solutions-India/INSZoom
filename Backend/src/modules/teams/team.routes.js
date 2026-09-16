// Settings → Users & Permissions → "Teams" (Case Manager Teams, §5.2.2).
// This directory existed (empty, never mounted) before this pass — filled
// in here rather than duplicating a parallel "teams" concept elsewhere.
const router = require("express").Router();
const { body } = require("express-validator");
const authenticate = require("../../middleware/authenticate");
const authorizePermissions = require("../../middleware/authorizePermissions");
const validate = require("../../middleware/validate");
const Team = require("../../models/Team");

router.use(authenticate, authorizePermissions("teams:read"));

router.get("/", async (req, res, next) => {
  try {
    res.json({ success: true, data: await Team.find({}).populate("members", "name displayName email role").sort({ name: 1 }) });
  } catch (error) { next(error); }
});

router.post("/", authorizePermissions("teams:create"), [body("name").trim().notEmpty()], validate, async (req, res, next) => {
  try {
    const team = await Team.create({ name: req.body.name, members: req.body.members || [], createdBy: req.user._id });
    res.status(201).json({ success: true, data: team });
  } catch (error) { next(error); }
});

router.patch("/:id", authorizePermissions("teams:update"), async (req, res, next) => {
  try {
    const update = {};
    if (req.body.name) update.name = req.body.name;
    if (req.body.members) update.members = req.body.members;
    const team = await Team.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true }).populate("members", "name displayName email role");
    if (!team) return res.status(404).json({ success: false, message: "Team not found" });
    res.json({ success: true, data: team });
  } catch (error) { next(error); }
});

router.delete("/:id", authorizePermissions("teams:delete"), async (req, res, next) => {
  try {
    const result = await Team.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: "Team not found" });
    res.json({ success: true });
  } catch (error) { next(error); }
});

module.exports = router;
