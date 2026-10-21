# Unlocked form boxes and their canonical paths

USCIS marks some boxes of its PDFs read-only (boxes its own script switches on, copies of a box on another page, signatures, barcodes). They are now
fillable in the form editor and in the downloaded PDF, except signatures, barcodes, computed fields, drop-downs and radio groups
(`Backend/src/modules/uscis-forms/field-lock-policy.js`; applied to the editor's field data, the editor's viewer PDF, and both PDF generators).

## State of the canonical mapping (measured 2026-10-21, all 37 active templates)

| | boxes |
|---|---|
| Unlocked boxes in total | 1,524 |
| Already had a canonical edge | 157 |
| Copies of a mapped box (same name on another page) | 34 - mapped by `UnlockedMirrorService` where the sibling edge is live and unambiguous |
| Still without a canonical path | about 1,330 |

Fifteen forms have **no canonical mapping at all** (not only their unlocked boxes): I-129S, I-134, I-360, I-526, I-526E, I-539A, I-612, I-693, I-751, I-829,
I-864, I-864EZ, N-400, N-565, N-600. Giving only their unlocked boxes a path is not meaningful until the form is mapped as a whole.

## What was done

* **I-140** - nine boxes now have generic canonical paths (`Backend/src/modules/form-mapping/config/i140FieldRules.js`, new registry paths in
  `canonical/config/i140CanonicalPaths.js`): consulate city / country (`beneficiary.consularProcessing.city|country`), country of residence
  (`beneficiary.countryOfResidence`), the three concurrent-filing boxes (`application.concurrentFilings.i485|i131|i765`), other petitioner type
  (`petitioner.entityTypeOther`), previous petition receipt (`petitioner.previousPetition.receiptNumber`), hours per week (`employment.hoursPerWeek`).
  Saved as I-140 mapping version 14. **It is not live**: a mapping version only goes live when every box of the form is either mapped or explicitly
  decided (Form Governance); I-140 has 234 boxes with no decision. "Keep blank" is not a substitute - it means nothing may ever be stored in the box.
  Three unreviewed draft edges from earlier, never-activated versions that put the wrong fact in a box were removed from the drafts.
* **Copies** - live now (new versions, activated): I-129 (1), I-129F (4), I-130 (4). Candidates not applied because those forms cannot be activated yet:
  I-134 (1), I-829 (1), I-864EZ (1), N-565 (1), N-600 (16).

## Complete form mappings (2026-10-21)

Four of the fifteen unmapped forms now have a complete, live (activated, contract-clean) canonical mapping. Each is an *exclusive* rule set: every box a generic
canonical fact can fill is mapped; every other box is deliberately left to the case manager (listed in the header of each rules file).

| Form | Rules file | Live version | Boxes mapped |
|---|---|---|---|
| I-864 | `form-mapping/config/i864FieldRules.js` | v4 | 79 |
| N-400 | `form-mapping/config/n400FieldRules.js` | v6 | 135 |
| I-129S | `form-mapping/config/i129sFieldRules.js` | v13 | 60 |
| I-751 | `form-mapping/config/i751FieldRules.js` | v4 | 141 |

Remaining without a mapping: I-134, I-360, I-526, I-526E, I-539A, I-612, I-693, I-829, I-864EZ, N-565, N-600.
New registry paths: `canonical/config/i864CanonicalPaths.js`, `i751CanonicalPaths.js`. Checkbox rules can now opt into a case-insensitive match (`ignoreCase`) and a
multi-select answer (race) ticks every option it contains - gender is normalised to "male" / "female", so an exact "Male" match would never have ticked.

## Interpreter and preparer boxes are never filled

`form-mapping/config/blankFieldPolicy.js` recognises the interpreter's / preparer's own boxes (by PDF name or "Enter Interpreter's / Preparer's ..." label) and
`FormMappingService.applyMappingGraph` drops every mapping, legacy mapping and default value for them, on every form and every mapping version. The boxes stay
editable by hand. Generic-named boxes of those blocks (an address line labelled only "Item 3: Street") are not detectable by name; no active mapping edge targets one
(audited 2026-10-21) and the rule files leave them unmapped.

Re-run: `node src/scripts/applyUnlockedMirrors.js <forms> [--apply]` (dry run by default), `node src/scripts/applyPartyFieldMappings.js I-140 [--apply]`.
