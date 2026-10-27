// Continuation sheets of a form that are slices of the SAME PDF but are not driven by a visa classification (no visa "requires" them): registered by hand
// (scripts/registerI129AdditionalBeneficiaryComponent.js) and re-derived for every new edition by USCISFormComponentDiscoveryService.
//
// I-129 "Attachment-1" (pages 37-38: the sheet that names each additional beneficiary of a multi-beneficiary petition). Owner decision 2026-10-28: it is its own sliced form, named
// "Attachment 1 I-129", listed with the other I-129 supplements. MappingMaintenanceService keeps that true by code:
//   - the slice's display name is brought to `name` (its code never changes - registry rows and open case forms reference it);
//   - a CONDITIONAL registry row (a case manager adds it when it applies; it is never auto-created for a case) exists for every visa type that files the parent form.
// Discovery leaves a registry row of one of these codes alone (it cannot match a printed heading and would otherwise create a duplicate "review required" component).
const CONTINUATION_SHEETS = Object.freeze([
  Object.freeze({
    componentCode: "I129_ADDITIONAL_BENEFICIARY",
    parentForm: "I-129",
    name: "Attachment 1 I-129",
    formNumber: "I-129 Attachment 1",
    notes: "Attachment-1 sheet (pages 37-38 of the I-129 PDF): names each additional beneficiary of a multi-beneficiary petition. A case manager adds it when it applies; never auto-created.",
    displayOrder: 150,
  }),
]);

const CONTINUATION_SHEET_CODES = new Set(CONTINUATION_SHEETS.map((sheet) => sheet.componentCode));

module.exports = { CONTINUATION_SHEETS, CONTINUATION_SHEET_CODES };
