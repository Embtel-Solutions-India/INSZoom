// Phase 4: Gemini mapping engine. Public surface of the module (the pipeline and the routes use only this).
//   mode()                     "off" (default) | "shadow" | "on"                           FORM_AI_MAPPING
//   suggestForTemplate(...)    suggestions for the boxes of an edition (stored; never touches a graph)
//   applyAutoUse(...)          mode "on" only: the auto_use tier into a NEW mapping version of a pending edition, gate permitting
//   runForTemplate(...)        the pipeline stage "ai_map"
// The accuracy gate (accuracy/AiMappingGate) belongs to the evaluation side; it is loaded lazily and anything but an explicit "open" means closed.
const { mode, MODES } = require("./mode");
const service = require("./GeminiMappingService");
const { tierOf, riskFlags } = require("./riskTier");

module.exports = { mode, MODES, tierOf, riskFlags, suggestForTemplate: service.suggestForTemplate, applyAutoUse: service.applyAutoUse, runForTemplate: service.runForTemplate, gateOpen: service.gateOpen };
