### [P2-001] `reverseSync` classification has no first-class signal on the compiled mapping graph - uses a documented heuristic
- Date: 2026-08-24
- Area / file(s): `Backend/src/modules/form-mapping/services/ReverseIndexService.js` (`classifyReverseSync`), `Backend/src/modules/form-mapping/seeds/i129-h1b-mapping.seed.js` (edge `mappingType` assignment)
- Category: reverse-index
- Symptom: none observed - the current heuristic classifies every checked example correctly
  (`person.lastName` → `true`, `person.fullName` → `false`). This is a structural gap, not an
  active bug.
- Reproduction: n/a (structural review). Confirmed via `node -e` probes and
  `ReverseIndexService.test.js` against the real seeded I-129 mapping graph.
- Root cause: the compiled `USCISMappingVersion.graph.edges[].mappingType` field is only ever
  assigned one of three values by the seed script - `"direct"`, `"date"`, or `"checkbox"` (see
  `i129-h1b-mapping.seed.js:71`: `mappingType: edge.transform?.type === "date" ? "date" :
  edge.condition ? "checkbox" : "direct"`). There is no `"derived"`/`"composite"` tag anywhere on
  the compiled edge, even though the crosswalk config clearly has derived/composite sources (e.g.
  `person.fullName`, built from `beneficiary.fullName`/`user.name` rather than a single atomic DB
  field). `ReverseIndexService.classifyReverseSync` therefore infers reversibility from a small,
  documented denylist of known composite source-path suffixes (currently just `"fullName"`) plus
  condition-presence and checkbox-mappingType, rather than reading a real property.
- Causing action: pre-existing (the `mappingType` assignment logic predates Phase 2; not
  introduced by this phase's `git log -S` search would need to trace back to the original H1
  crosswalk work).
- Impact: as the crosswalk grows (new composite/derived fields added for other visa types), each
  one must be manually added to `DERIVED_SOURCE_PATH_SUFFIXES` or it will default to
  `reverseSync:true` (an atomic mapping is the more common case, so "true" is the safer default for
  an unrecognized *non-composite* path - but a genuinely new composite path that isn't yet in the
  denylist would be silently misclassified as reversible, risking a guessed reverse-mapping later).
- Phase-2 handling: characterized-only, not fixed - `overrideField`'s dependence on this
  classification is exercised and correct for every field checked in this phase's test suite, but
  the classifier itself is a heuristic, not a first-class property.
- Status: open
- Planned fix phase: whichever later phase introduces a mapping-schema change (crosswalk edges
  gain an explicit `derived`/`composite` boolean at authoring time, read directly instead of
  inferred) - do not solve this by touching the crosswalk config or `MappingGraphService` outside
  a phase whose scope explicitly covers the mapping schema.
