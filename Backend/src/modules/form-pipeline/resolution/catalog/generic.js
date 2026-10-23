// The generic portfolio (Discovery): safe alternatives per stage for a failure no catalog entry solved. Never matched directly (matches is always false); Discovery orders
// the ids of `stages` by past success. Each strategy calls an injectable dependency the stage owner provides; without it the strategy reports ok:false and the next is tried.
const { depStrategy, NOT_PROVIDED } = require("./_helpers");

const strategies = [
  depStrategy({ id: "generic_retry_longer_timeout", description: "run the stage again with a longer timeout", depName: "retryWithTimeout" }),
  depStrategy({ id: "generic_fresh_temp_dir", description: "run the stage again in a fresh temporary directory (separates a lost temp file from a lost tool)", depName: "freshTempDir" }),
  depStrategy({ id: "generic_reresolve_source", description: "resolve the official page / PDF address again", depName: "reresolveSource" }),
  depStrategy({ id: "generic_alternate_parser", description: "use the alternate parser / normalizer for this stage", depName: "alternateParser" }),
];

module.exports = {
  id: "generic",
  description: "generic alternatives, tried when nothing more specific solved the failure",
  matches: () => false,
  NOT_PROVIDED,
  stages: {
    detect: ["generic_reresolve_source", "generic_retry_longer_timeout"],
    import: ["generic_fresh_temp_dir", "generic_retry_longer_timeout", "generic_alternate_parser", "generic_reresolve_source"],
    map: ["generic_retry_longer_timeout"],
    certify: ["generic_alternate_parser", "generic_retry_longer_timeout"],
    default: ["generic_retry_longer_timeout"],
  },
  strategies,
};
