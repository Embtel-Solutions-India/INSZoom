// node src/modules/form-mapping/seeds/i485-perm-mapping.seed.js
// Activates the PERM-sourced I-485 mapping graph (config/i485-perm-crosswalk.js) - see permCrosswalkSeed.js.
const crosswalk = require("../config/i485-perm-crosswalk");
const { createPermCrosswalkSeed } = require("./permCrosswalkSeed");

const { seed, buildGraph, runCli } = createPermCrosswalkSeed({ formCode: "I-485", crosswalk, missingSource: crosswalk.INDIVIDUAL_UNMAPPED });
module.exports = seed;
module.exports.buildCrosswalkGraph = buildGraph;
if (require.main === module) runCli("i485-perm-mapping.seed");
