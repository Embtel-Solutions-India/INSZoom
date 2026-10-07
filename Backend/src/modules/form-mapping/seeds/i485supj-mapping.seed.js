// node src/modules/form-mapping/seeds/i485supj-mapping.seed.js   (npm run seed:i485supj-mapping)
// Activates the I-485 Supplement J autofill graph (config/i485supj-crosswalk.js) on the active I-485J template
// (imported by ../../uscis-form-import/seeds/i485supj.seed.js) - see permCrosswalkSeed.js. Idempotent by content
// checksum; every earlier mapping version is kept, so it is reversible.
const crosswalk = require("../config/i485supj-crosswalk");
const { createPermCrosswalkSeed } = require("./permCrosswalkSeed");

const { seed, buildGraph, runCli } = createPermCrosswalkSeed({ formCode: "I-485J", crosswalk, missingSource: crosswalk.INDIVIDUAL_UNMAPPED });
module.exports = seed;
module.exports.buildCrosswalkGraph = buildGraph;
if (require.main === module) runCli("i485supj-mapping.seed");
