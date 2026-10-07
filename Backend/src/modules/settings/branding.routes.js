const router = require("express").Router();
const settingsEngine = require("./settingsEngine.service");

// Public, read-only: the firm's brand (name, short name, colour, logo) is shown
// on pre-login screens too, so this takes no auth. Values come straight from
// the settings engine (firm.* keys), so a Settings -> Firm Profile save is
// reflected on the next read in every app.
router.get("/", async (req, res, next) => {
  try {
    const [name, displayName, primaryColor, logo] = await Promise.all([
      settingsEngine.getEffective("firm.name"),
      settingsEngine.getEffective("firm.displayName"),
      settingsEngine.getEffective("firm.primaryColor"),
      settingsEngine.getEffective("firm.logo"),
    ]);
    res.set("Cache-Control", "no-store");
    res.json({ success: true, data: { name, displayName, primaryColor, logo } });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
