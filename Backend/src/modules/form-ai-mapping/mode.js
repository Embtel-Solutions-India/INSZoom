// Phase 4 flag: FORM_AI_MAPPING = off (DEFAULT) | shadow | on. Read through this one function so nothing else interprets the variable.
//   off     nothing runs, no model is ever called
//   shadow  suggestions are computed and STORED; no mapping graph is touched (the first proof runs, plan Phase 4)
//   on      additionally the narrow auto_use tier may be written into a NEW mapping version of a pending edition - but only while the accuracy gate is open
// Anything else (a typo, an empty value) is "off": a bad value can never switch the AI on.
const MODES = Object.freeze(["off", "shadow", "on"]);

function mode(env = process.env) {
  const value = String(env.FORM_AI_MAPPING || "off").trim().toLowerCase();
  return MODES.includes(value) ? value : "off";
}

module.exports = { mode, MODES };
