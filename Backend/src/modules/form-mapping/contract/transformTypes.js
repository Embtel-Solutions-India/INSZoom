// The transform types MappingResolver actually implements, kept in ONE list the validator reads. A test (transformTypes.test.js) reads MappingResolver's own
// source and fails if this list and the resolver ever drift apart, so the contract can never accept a transform the resolver does not run (or reject one it does).
const APPLY_TRANSFORMS = Object.freeze([
  "date", "dateFormat", "boolean", "checkbox", "arrayItem", "digits", "address", "country", "cityCountry", "usState", "nonUsProvince", "listItem", "constant", "join", "digitAt",
  "string", "uppercase", "lowercase", "ssn", "alienNumber", "uscisReceiptNumber", "phone", "direct",
]);
// derived values (MappingResolver.resolveDerivedValue): computed from other paths, so their referenced paths must exist
const DERIVED_TRANSFORMS = Object.freeze(["fullName", "concat", "age", "yearsOfExperience", "countryName", "radio", "dropdown"]);
const SUPPORTED_TRANSFORMS = Object.freeze([...new Set([...APPLY_TRANSFORMS, ...DERIVED_TRANSFORMS])]);

// condition operators MappingResolver.compare implements
const CONDITION_OPERATORS = Object.freeze(["equals", "==", "not_equals", "!=", "in", "not_in", "exists", "hasValue", "empty", "gt", ">", "gte", ">=", "lt", "<", "lte", "<=", "contains"]);

module.exports = { APPLY_TRANSFORMS, DERIVED_TRANSFORMS, SUPPORTED_TRANSFORMS, CONDITION_OPERATORS };
