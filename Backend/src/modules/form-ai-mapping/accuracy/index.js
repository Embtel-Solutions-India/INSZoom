// Phase 4 accuracy gate: pre-approved thresholds, the pure evaluator, and the fail-closed gate the engine's "on" mode consults.
module.exports = { ...require("./thresholds"), ...require("./evaluate"), ...require("./AiMappingGate") };
