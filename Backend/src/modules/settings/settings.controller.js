const Settings = require("../../models/Settings");

function employerView(settings) {
  return {
    companyName: settings.companyName,
    companyLogo: settings.companyLogo,
    timezone: settings.timezone,
    dateFormat: settings.dateFormat,
    defaultLanguage: settings.defaultLanguage,
    primaryColor: settings.primaryColor,
  };
}

async function getSettings(req, res, next) {
  try {
    const settings = await Settings.findOneAndUpdate({ key: "global" }, { $setOnInsert: { key: "global" } }, { new: true, upsert: true, setDefaultsOnInsert: true });
    res.json({ success: true, settings: req.user.role === "employer" ? employerView(settings) : settings, data: req.user.role === "employer" ? employerView(settings) : settings });
  } catch (error) {
    next(error);
  }
}

async function updateSettings(req, res, next) {
  try {
    const payload = { ...req.body };
    if (req.user.role === "employer") {
      Object.keys(payload).forEach((key) => {
        if (!["companyName", "companyLogo", "timezone", "dateFormat", "defaultLanguage", "primaryColor"].includes(key)) delete payload[key];
      });
    }
    const settings = await Settings.findOneAndUpdate(
      { key: "global" },
      { ...payload, lastUpdatedBy: req.user._id, lastUpdatedAt: new Date() },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true, message: "Settings updated successfully", settings, data: settings });
  } catch (error) {
    next(error);
  }
}

module.exports = { getSettings, updateSettings };
