// Single source of truth for the H-4 Extension / H-4 EAD checklist +
// USCIS-form decision (task spec §3). Both checklist assignment
// (single-party-filing.controller.js) and any UI mirroring must resolve
// through this one function — never re-implement this condition inline
// anywhere else.
//
// Decision matrix (task spec §1):
//   false + false -> no H-4 checklist / no H-4 forms
//   true  + false -> H4_EXTENSION (filingTypes.js key) -> I-539
//   false + true  -> H4_EAD (filingTypes.js key)       -> I-765
//   true  + true  -> H4_EXTENSION_EAD (filingTypes.js key) -> I-539 + I-765

const { FILING_TYPES } = require("../../config/filingTypes");

function resolveH4Checklist({ h4ExtensionSelected, h4EadSelected }) {
  const extension = Boolean(h4ExtensionSelected);
  const ead = Boolean(h4EadSelected);
  if (extension && ead) {
    return { filingType: FILING_TYPES.H4_EXTENSION_EAD, forms: ["I-539", "I-765"] };
  }
  if (extension) {
    return { filingType: FILING_TYPES.H4_EXTENSION, forms: ["I-539"] };
  }
  if (ead) {
    return { filingType: FILING_TYPES.H4_EAD, forms: ["I-765"] };
  }
  return { filingType: null, forms: [] };
}

module.exports = { resolveH4Checklist };
