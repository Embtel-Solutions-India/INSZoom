### [P4-003] I-129F (K-1) had the same never-activated-mapping-version defect as I-130 (P0-CD-001) - found and fixed
- Date: 2026-08-25
- Area / file(s): the I-129F `USCISMappingVersion` document (data fix via
  `npm run seed:i129f-k1-mapping`, no code change)
- Category: stale-seed
- Symptom: not part of any explicitly-named prior defect - discovered while checking, for
  completeness, whether the SAME `activeMappingVersionId` gap that caused P0-CD-001 also affected
  the other two crosswalks (I-129 and I-129F), rather than assuming P0-CD-001 was an I-130-only
  issue.
- Reproduction: `USCISFormTemplate.findOne({formCode:"I-129F", status:"active"}).activeMappingVersionId`
  was `undefined`, identical to I-130's pre-fix state (see P4-001). I-129 (H-1B/L-1A), by contrast,
  already had `activeMappingVersionId` set correctly before this phase touched anything.
- Root cause: identical mechanism to P4-001 - `MappingGraphService.activate()` had never
  successfully activated a mapping version for I-129F, so `FormMappingService.applyMappingGraph`
  had never overwritten `formFields[].mappings` with the reviewed 34-edge crosswalk; runtime
  resolution used whatever stale, unreviewed auto-suggested data was already stored (149 of 445
  fields carried SOME stored mapping, vs. only 34 reviewed edges).
- Causing action: unknown, same as P4-001.
- Impact: potentially incorrect field values on generated K-1 (I-129F) petitions from stale,
  unreviewed mappings - not separately quantified field-by-field the way P0-CD-001's 10 fields were
  (no prior candidate-defect scan targeted I-129F specifically), but the mechanism is identical and
  the same category of risk applies. No K-1 golden PDF fixture exists (Phase 0's golden visa keys
  are h1b/l1a/k3 only), so this fix has no golden-snapshot diff to show; verified instead via
  `ReverseIndexService` before/after (the reverse index's only reverseSync-eligible sources are now
  the 26 genuinely-reviewed `raw.questionnaireAnswers.{petitioner,beneficiary}_info_*` paths) and via
  the existing `i129f-k1-crosswalk-coverage.test.js` (part of `phase0:verify`'s invariant suite,
  confirmed still green).
- Phase-4 handling: fixed-in-phase. Ran `npm run seed:i129f-k1-mapping` (unchanged file). Confirmed
  idempotent on a second run (same 2 `USCISMappingVersion` documents, no duplicate). Two existing
  Phase 2/3 tests that had (unknowingly) relied on a stale, non-crosswalk mapping
  (`person.citizenship`, a 2-way fan-out that doesn't exist in the reviewed crosswalk) were updated
  to use a genuinely-reviewed field (`raw.questionnaireAnswers.petitioner_info_lastName.value`) -
  see `docs/forms/PHASE4_RUN_JOURNAL.md` for why this is a correction, not a weakening.
- Status: resolved
- Planned fix phase: n/a (fixed here). Recommend a future phase add an explicit invariant test
  asserting `activeMappingVersionId` is set (and points at a `status:"active"` version) for every
  crosswalk-mapped `USCISFormTemplate`, so this defect class is caught automatically rather than
  requiring a manual check like the one that found it here.
