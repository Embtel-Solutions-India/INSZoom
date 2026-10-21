// Form I-140: generic canonical paths for the boxes that USCIS marks read-only because its own script switches them on (so they were not fillable, and had no
// canonical value). Each rule names the generic canonical path (beneficiary.* / petitioner.* / employment.* / application.*) and the exact PDF field-name stem it
// feeds; nothing here is specific to a visa or a questionnaire. Applied by PartyFieldMappingService as a NEW mapping version that only ADDS edges for these
// fields - every edge the form already has is kept as it is.
//
// Deliberately NOT mapped (no canonical fact says the same thing, so a guess could put a wrong value on the form): the "pre-populated from Page 1" copies of
// the page-1 name on page 8 (their master boxes carry no rule yet), and the "Additional Information" attachment box.
const R = (to, stems, options = {}) => ({ to, stems: [].concat(stems), ...options });

const I140_RULES = [
  // Unreviewed draft edges from earlier (never activated) mapping versions that put the wrong fact in these boxes are removed: Part 1 Item 1 asks for the
  // individual petitioner's name (not the worker's), and an apartment / suite / floor number is not the first line of the address.
  R("", ["Pt1Line1a_FamilyName", "Pt1Line1c_MiddleName", "Line6c_AptSteFlrNumber"], { remove: true }),
  // Part 4 Item 1 (page 2): the consulate where the beneficiary will apply for the visa - city and country
  R("beneficiary.consularProcessing.city", "Line1a_CityorTown", { pages: [2] }),
  R("beneficiary.consularProcessing.country", "Line1a_Country", { pages: [2], transform: { type: "country" } }),
  // Part 4 Item 2 (page 3): the beneficiary's current country of residence (or last permanent residence abroad)
  R("beneficiary.countryOfResidence", "Line1b_Country", { pages: [3], transform: { type: "country" } }),
  // Part 4 Item 6 (page 3): applications filed together with the petition
  R("application.concurrentFilings.i485", "Line4_Form485", { pages: [3], checkbox: true }),
  R("application.concurrentFilings.i131", "Line4_Form131", { pages: [3], checkbox: true }),
  R("application.concurrentFilings.i765", "Line4_Form765", { pages: [3], checkbox: true }),
  // Part 1 Item 1 (page 3): "Other" type of petitioner, explained
  R("petitioner.entityTypeOther", "Line1c_Explain", { pages: [3] }),
  // Part 2 Item 2 (page 2): the receipt number of the petition filed earlier
  R("petitioner.previousPetition.receiptNumber", "Line2a_ReceiptNumber", { pages: [2] }),
  // Part 5 Item 5 (page 4): hours per week
  R("employment.hoursPerWeek", "Line5_Hours", { pages: [4] }),
];

module.exports = { I140_RULES };
