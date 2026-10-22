// One field made the scanner throw. Isolate it, keep the rest of the form, and record the field as "needs review" instead of failing the import.
const { depStrategy } = require("./_helpers");

module.exports = {
  id: "scanFieldException",
  description: "scanning one field raised an error",
  matches: (diagnosis) => diagnosis.cause === "scan_field_exception",
  strategies: [
    depStrategy({ id: "isolate_failing_field", description: "skip the failing field, import the others, list the field as unmapped / needs review", depName: "isolateFailingField" }),
  ],
};
