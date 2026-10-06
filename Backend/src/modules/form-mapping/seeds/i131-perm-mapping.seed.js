// node src/modules/form-mapping/seeds/i131-perm-mapping.seed.js
// Activates the PERM-sourced I-131 mapping graph (config/i131-perm-crosswalk.js) - see permCrosswalkSeed.js.
const crosswalk = require("../config/i131-perm-crosswalk");
const { createPermCrosswalkSeed } = require("./permCrosswalkSeed");

const { seed, buildGraph, runCli } = createPermCrosswalkSeed({ formCode: "I-131", crosswalk, missingSource: crosswalk.UNMAPPED_ENTRIES });
module.exports = seed;
module.exports.buildCrosswalkGraph = buildGraph;
if (require.main === module) runCli("i131-perm-mapping.seed");
