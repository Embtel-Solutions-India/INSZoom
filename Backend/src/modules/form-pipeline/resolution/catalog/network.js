// Network failures (reset, timeout, 5xx, 429). The job's own backoff with jitter is the first answer; these are the extra alternatives.
const { depStrategy } = require("./_helpers");

module.exports = {
  id: "network",
  description: "uscis.gov could not be reached or answered with a temporary error",
  matches: (diagnosis) => diagnosis.cause === "network",
  strategies: [
    depStrategy({ id: "network_host_variant", description: "retry the request through the other host form (www. / apex) and HTTP/1.1", depName: "fetchVariant" }),
    depStrategy({ id: "network_longer_timeout", description: "retry once with a longer timeout", depName: "retryWithTimeout" }),
  ],
};
