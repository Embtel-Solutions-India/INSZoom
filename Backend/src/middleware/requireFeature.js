const settingsEngine = require("../modules/settings/settingsEngine.service");

// §4.10 Feature Flags / Modules. moduleKey must match one of
// settings/registry/modules.registry.js's MODULES entries
// (modules.<moduleKey>.enabled). Mounted at the router level for a whole
// module's route group — disabling a module 404s its entire API surface
// immediately (no restart), matching the frontend's useFeatureFlag hook
// hiding the corresponding nav item.
function requireFeature(moduleKey) {
  return async (req, res, next) => {
    try {
      const enabled = await settingsEngine.getEffective(`modules.${moduleKey}.enabled`, {});
      if (!enabled) {
        return res.status(404).json({ success: false, message: "This module is not enabled", code: "MODULE_DISABLED" });
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = requireFeature;
