// Phase 2 mapping contract: origins and the one mapping policy, the live path universe, the contract validator, coverage, default-value classes and field equivalence.
module.exports = {
  ...require("./MappingPolicy"),
  ...require("./PathUniverse"),
  ...require("./MappingContractValidator"),
  ...require("./MappingCoverageService"),
  ...require("./defaultValueClassifier"),
  ...require("./fieldEquivalence"),
  ...require("./transformTypes"),
};
