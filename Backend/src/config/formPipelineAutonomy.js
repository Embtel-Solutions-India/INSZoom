// Phase 7 rollout switch: FORM_PIPELINE_AUTONOMY = off | shadow | on (default off; anything else is off).
//   off     today's behavior exactly
//   shadow  the new autonomous behavior is computed and logged as "would have done X", but nothing is acted on
//   on      the new behavior is applied
// Read at call time (not at load time) so a restart is not needed in tests and the value is always current.
const MODES = Object.freeze(["off", "shadow", "on"]);

function mode(env = process.env) {
  const value = String(env.FORM_PIPELINE_AUTONOMY || "off").trim().toLowerCase();
  return MODES.includes(value) ? value : "off";
}

const isOn = (env = process.env) => mode(env) === "on";
const isShadow = (env = process.env) => mode(env) === "shadow";

module.exports = { MODES, mode, isOn, isShadow };
