// Visa types whose checklists are filled ONE AFTER ANOTHER on a single page (the first checklist's sections, then the next checklist's sections under its own heading, with one
// Save progress / Submit case for the whole case) instead of switching between tabs. Every other case type keeps the page behaviour it has today (a tab bar when it has several
// checklists). Display only: it never changes which checklists a case has or how they are saved.
export const STACKED_CHECKLIST_VISA_TYPES = new Set(["US-VISITOR-VISA"]);

export function isStackedChecklistCase(caseData) {
  return STACKED_CHECKLIST_VISA_TYPES.has(caseData?.visaType);
}
