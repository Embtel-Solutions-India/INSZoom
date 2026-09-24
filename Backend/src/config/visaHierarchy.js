// Canonical visa parent/child hierarchy, keyed on the raw hyphenated
// strings actually stored on Case.visaType (confirmed via
// Admin/frontend/src/components/CreateCaseModal.jsx, which submits the
// label - not a stripped/normalized key) - deliberately separate from
// visaTypes.js's own stripped-key canonicalizer (VISA_TYPES/normalizeVisaType),
// which several other call sites already depend on and which this change
// does not touch.
//
// Every entry here is a genuine subclassification of the same underlying
// petition (e.g. P-1A/P-1B are athlete/entertainer variants of the same
// P-1 I-129 petition) - NOT a dependent/derivative status. P-4 (P visa
// holder's dependent) is deliberately absent: it already has its own
// correct, independent VisaFormMapping rows (I-539/DS-160, no I-129) and
// must never inherit P-1's I-129.
const VISA_HIERARCHY = {
  // Two-level P chain: P-1/P-2/P-3 are themselves children of the bare "P"
  // classification (the employment-workflow checklist registry's own
  // umbrella - p.js's matches() only recognizes bare "P" or an explicit
  // P-1A/P-1B/P-3 suffix, never "P-1"/"P-2" themselves), while P-1/P-2/P-3
  // are each the parent VisaFormMapping key their own subtypes fall back to
  // (VisaFormMapping.seed.js keys its P-1/P-2/P-3 rows exactly this way).
  // The shared walker (resolveWithHierarchyFallback) already supports
  // multi-level chains - no special-casing needed beyond this extra entry.
  "P": { children: ["P-1", "P-2", "P-3"] },
  "P-1": { children: ["P-1A", "P-1B", "P-1S"] },
  "P-2": { children: ["P-2S"] },
  "P-3": { children: ["P-3S"] },
  "L-1": { children: ["L-1A", "L-1B"] },
  "O-1": { children: ["O-1A", "O-1B"] },
  "EB-1": { children: ["EB-1A", "EB-1B", "EB-1C"] },
  "EB-2": { children: ["EB-2 PERM", "EB-2 NIW"] },
  "EB-3": { children: ["EB-3 Skilled Worker", "EB-3 Professional", "EB-3 Other Worker"] },
  "EB-5": { children: ["EB-5 Regional Center", "EB-5 Standalone"] },
  "TN": { children: ["TN Canada", "TN Mexico"] },
  "H-1B1": { children: ["H-1B1 Chile", "H-1B1 Singapore"] },
  // H4EXTENSION/H4EAD/H4EXTENSIONEAD are single-party filing-type
  // variants of the same H-4 dependent status (filingTypes.js), each with
  // its own dedicated VisaFormMapping rows (visaFormMappings.seed.js) that
  // always win first — this parent link only matters as a fallback if one
  // of those dedicated rows were ever removed.
  "H-4": { children: ["H4EXTENSION", "H4EAD", "H4EXTENSIONEAD"] },
  // COSF2 is the single-party filing-type variant of F-2 (filingTypes.js's
  // COS_F2) — same fallback-only relationship as the H-4 entry above.
  "F-2": { children: ["COSF2"] },
};

const PARENT_BY_CHILD = Object.entries(VISA_HIERARCHY).reduce((map, [parent, { children }]) => {
  children.forEach((child) => { map[child] = parent; });
  return map;
}, {});

function getParentVisa(visaType) {
  return PARENT_BY_CHILD[visaType] || null;
}

// Generic fallback walker shared by both the VisaFormMapping resolver
// (visaFormMapping.service.js) and the checklist resolver
// (visaChecklists.js) - one traversal, not two copies of the same logic.
// Walks the FULL parent chain (not just one hop) until lookupFn returns a
// non-empty result or the chain ends at a root with no parent.
//
// A specific/exact mapping always wins: the walker only advances past the
// starting visaType when isEmpty(result) is true for it, so a visa with its
// own dedicated mapping/checklist never gets its parent's data merged in.
async function resolveWithHierarchyFallback(visaType, lookupFn, isEmpty) {
  const chain = [visaType];
  let current = visaType;
  let result = await lookupFn(current);
  while (isEmpty(result)) {
    const parent = getParentVisa(current);
    if (!parent) {
      return { result, resolvedVisaType: null, chain, usedFallback: false, unresolved: true };
    }
    current = parent;
    chain.push(current);
    result = await lookupFn(current);
  }
  return { result, resolvedVisaType: current, chain, usedFallback: current !== visaType, unresolved: false };
}

module.exports = { VISA_HIERARCHY, getParentVisa, resolveWithHierarchyFallback };
