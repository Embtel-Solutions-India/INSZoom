// Phase 7: the switch lives in config/ (it is pure and has no imports) so hot-path files can read it without reaching the pipeline modules; this re-export keeps the pipeline-side name.
module.exports = require("../../config/formPipelineAutonomy");
