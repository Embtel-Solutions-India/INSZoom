// Phase 7.3: semantic field matching (see FieldMatcher.js). Nothing here touches a database; the integration points are gated by FORM_PIPELINE_AUTONOMY.
const FieldMatcher = require("./FieldMatcher");
const FieldFingerprint = require("./FieldFingerprint");
const stableKey = require("./stableKey");

/** Bumped when the matching rules change in a way that can turn an old "unmatched" into a match (feeds the hold contract's evaluatedWith.matcher). */
const MATCHER_VERSION = 1;

module.exports = { ...FieldMatcher, FieldFingerprint, ...stableKey, MATCHER_VERSION };
