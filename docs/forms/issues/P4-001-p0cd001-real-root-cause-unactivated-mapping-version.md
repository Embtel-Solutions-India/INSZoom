### [P4-001] P0-CD-001's real root cause: I-130's USCISMappingVersion was never activated, not a fieldId-key mismatch
- Date: 2026-08-25
- Area / file(s): `Backend/src/modules/form-mapping/services/MappingGraphService.js` (`applyGraphToTemplate`,
  `activate`, `persistVersion` - read, not modified), `Backend/src/models/USCISFormTemplate.js`
  (`activeMappingVersionId`), the I-130 `USCISMappingVersion` document itself (data fix via
  `npm run seed:i130-k3-mapping`, no code change)
- Category: stale-seed
- Symptom: 10 petitioner/beneficiary identity fields (name, DOB, birthplace) rendered blank on the
  generated I-130/K-3 PDF despite the crosswalk (`i130-k3-crosswalk.js`) having correct, reviewed
  edges for all 10.
- Reproduction: `USCISFormTemplate.findOne({formCode:"I-130", status:"active"}).activeMappingVersionId`
  was `undefined`. The one `USCISMappingVersion` document for I-130 had `status:"needs_review"`,
  never `"active"`.
- Root cause: the task's original hypothesis (Phase 3 research, carried into this phase's own §E)
  was that `applyMappingGraph` looks up mappings by a `sha1`-based `fieldId` that had drifted between
  a stale seed run and the current template - i.e. a GLOBAL key mismatch that would break every
  field, not just 10. This was verified and found **wrong**: the live template's `fieldId` values
  and the stored mapping version's `targetFieldId` values matched exactly (same document, same IDs),
  and dozens of OTHER I-130 fields resolved correctly at runtime, which a global key mismatch could
  not explain. The REAL mechanism: `USCISFormTemplate.formFields[].mappings` is written directly onto
  the template document by `MappingGraphService.applyGraphToTemplate` at seed time, and that function
  falls back to a field's PRIOR mapping (`mappingsByTarget.get(fieldId) || plain.mappings || []`)
  whenever the freshly-built graph doesn't produce an edge for it. Separately,
  `FormMappingService.loadMappingVersion` (used at RUNTIME) only reads the graph-derived
  `USCISMappingVersion` document when `template.activeMappingVersionId` is set; when it's unset (as
  it was for I-130), `FormMappingService.applyMappingGraph` returns the template UNCHANGED, meaning
  runtime resolution used whatever was already baked into `formFields[].mappings` - which, for the
  10 P0-CD-001 fields specifically, were STALE, low-confidence (34-41%), `needs_review`-status,
  auto-suggested mappings pointing at semantically wrong sources (e.g. the petitioner's family-name
  field mapped to the single shared, beneficiary-scoped `person.lastName`; a city-of-birth field
  mapped to `contact.address.city` with an erroneously-attached date transform; a beneficiary
  family-name field mapped to `company.name`). `classifyField()` in the CURRENT crosswalk file
  already correctly classifies all 10 fields as "mapped" with the right per-role
  `raw.questionnaireAnswers.{petitioner,beneficiary}_info_*` sources - confirmed directly by calling
  it before making any change. The crosswalk was never broken; the mapping version built from it had
  simply never been (re-)activated since whatever earlier pass populated the stale auto-suggested
  data.
- Causing action: unknown (not investigated via `git blame`/`git log -S` - the stale auto-suggested
  mappings on `formFields[]` predate this session and their origin isn't traceable from the
  crosswalk/seed history alone).
- Impact: every K-3 petition generated before this fix had all 10 identity fields blank, plus a
  further ~112 other I-130 fields (of the 155 that carried SOME stored mapping) carrying stale,
  unreviewed, sometimes actively-wrong values from before the crosswalk was authored (see P4-003 for
  the same defect class found on I-129F/K-1, and the K-3 golden snapshot diff in
  `docs/forms/PHASE4_RUN_JOURNAL.md` for a concrete example - a beneficiary email field that had
  been silently filled with the PETITIONER's email).
- Phase-4 handling: fixed-in-phase. Ran `npm run seed:i130-k3-mapping` (unchanged file - the seed
  script and crosswalk were already correct) against the test DB. This both fills the 10 P0-CD-001
  fields correctly AND clears every other stale auto-suggested mapping, since
  `FormMappingService.applyMappingGraph` now runs against a genuinely active mapping version derived
  from ONLY the 33 reviewed `MAPPED_EDGES`. Verified via a new golden-path test
  (`i130-k3-golden-case.test.js`) that reads the actual generated PDF bytes via pdf-lib.
- Status: resolved
- Planned fix phase: n/a (fixed here). Note for later phases: confirm any newly-authored crosswalk
  (Phase 4b's I-134/I-539/I-539A/I-907) has its `MappingGraphService.activate()` call actually
  succeed at seed time - this failure mode is silent (the seed script doesn't surface a warning when
  `persistVersion` succeeds but the subsequent `activate()` throws, since `persistVersion`'s write
  already lands regardless) and could recur invisibly.
