const User = require("../../../models/User");
const { upgradeTrackedForms } = require("../../uscis-form-import/services/FormEditionUpgradeService");

// Daily, off by default outside production (same gate as the monitoring job); USCIS_EDITION_UPGRADE_ENABLED=true turns it on anywhere.
function startUSCISEditionUpgradeJob() {
  const configured = process.env.USCIS_EDITION_UPGRADE_ENABLED;
  const enabled = configured === "true" || (configured === undefined && process.env.NODE_ENV === "production");
  if (!enabled) return null;
  const intervalMs = Number(process.env.USCIS_EDITION_UPGRADE_INTERVAL_MS || 24 * 60 * 60 * 1000);
  const initialDelayMs = Number(process.env.USCIS_EDITION_UPGRADE_INITIAL_DELAY_MS || 5 * 60 * 1000);
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const actor = await User.findOne({ role: { $in: ["super_admin", "admin"] } }).sort({ createdAt: 1 });
      await upgradeTrackedForms({ user: actor || { role: "super_admin" } });
    } catch (error) {
      console.error("USCIS edition upgrade failed:", error.message);
    } finally {
      running = false;
    }
  };
  const initial = setTimeout(run, Math.max(initialDelayMs, 0));
  initial.unref?.();
  return setInterval(run, intervalMs);
}

module.exports = { startUSCISEditionUpgradeJob };
