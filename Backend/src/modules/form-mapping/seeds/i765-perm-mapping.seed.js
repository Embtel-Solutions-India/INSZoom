// node src/modules/form-mapping/seeds/i765-perm-mapping.seed.js
// Activates the PERM-sourced I-765 mapping graph (config/i765-perm-crosswalk.js) - see permCrosswalkSeed.js.
const crosswalk = require("../config/i765-perm-crosswalk");
const { createPermCrosswalkSeed } = require("./permCrosswalkSeed");

const { seed, buildGraph, runCli } = createPermCrosswalkSeed({ formCode: "I-765", crosswalk, missingSource: crosswalk.MISSING_SOURCE_TARGETS });
module.exports = seed;
module.exports.buildCrosswalkGraph = buildGraph;
if (require.main === module) runCli("i765-perm-mapping.seed");
