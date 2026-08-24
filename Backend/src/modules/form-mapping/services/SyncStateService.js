// Phase 2 (§I.4) - the three explicit sync states for a data-bound CaseForm field. Stored inside
// sourceAttribution[pdfField] (already Mixed - no CaseForm schema change; CaseForm.syncState
// itself is a strictly-typed subdocument and would silently drop an unknown sub-key, see
// docs/forms/PHASE2_BASELINE.md), alongside the existing source/confidence/validationStatus keys
// AutoFillService already writes there.
const SYNCED = "SYNCED";
const MANUAL_OVERRIDE = "MANUAL_OVERRIDE";
const CONFLICT = "CONFLICT";

class SyncStateService {
  static SYNCED = SYNCED;
  static MANUAL_OVERRIDE = MANUAL_OVERRIDE;
  static CONFLICT = CONFLICT;

  // A field with no sync-state marker yet (e.g. never touched by this phase's code) defaults to
  // SYNCED - a freshly auto-filled, never-overridden field is trivially in sync with canonical.
  static getSyncState(caseForm, pdfField) {
    return caseForm?.sourceAttribution?.[pdfField]?.syncState || SYNCED;
  }

  static setSynced(caseForm, pdfField) {
    const sourceAttribution = { ...(caseForm.sourceAttribution || {}) };
    const { conflictCanonicalValue, conflictManualValue, ...rest } = sourceAttribution[pdfField] || {};
    sourceAttribution[pdfField] = { ...rest, syncState: SYNCED };
    caseForm.set("sourceAttribution", sourceAttribution);
    return caseForm;
  }

  static setManualOverride(caseForm, pdfField) {
    const sourceAttribution = { ...(caseForm.sourceAttribution || {}) };
    const { conflictCanonicalValue, conflictManualValue, ...rest } = sourceAttribution[pdfField] || {};
    sourceAttribution[pdfField] = { ...rest, syncState: MANUAL_OVERRIDE };
    caseForm.set("sourceAttribution", sourceAttribution);
    return caseForm;
  }

  // Marks pdfField in conflict WITHOUT touching its stored value - the manual override that's
  // already there (filledData/fieldValues/sourceAttribution.value, all untouched by this call)
  // stays exactly as it was; canonicalValue/manualValue are recorded for the CM to compare.
  static setConflict(caseForm, pdfField, canonicalValue, manualValue) {
    const sourceAttribution = { ...(caseForm.sourceAttribution || {}) };
    sourceAttribution[pdfField] = { ...(sourceAttribution[pdfField] || {}), syncState: CONFLICT, conflictCanonicalValue: canonicalValue, conflictManualValue: manualValue };
    caseForm.set("sourceAttribution", sourceAttribution);
    return caseForm;
  }
}

module.exports = SyncStateService;
