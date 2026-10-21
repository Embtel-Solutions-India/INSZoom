// Canonical facts asked by boxes of Form I-140 that USCIS switches on only when an option above them is chosen (so they were read-only in the PDF and are
// now fillable). Same extension mechanism as i907CanonicalPaths.js: ANY question.mapping.canonicalPath is promoted into Case.canonicalProfile verbatim, so a
// path only has to be REGISTERED here and wired to its field in form-mapping/config/i140FieldRules.js. Additive only; every path is a generic
// petitioner.* / beneficiary.* / employment.* / application.* fact, never specific to one form or visa.
const I140_CANONICAL_FIELDS = Object.freeze([
  // Part 5 Item 5: how many hours a week the job is
  { path: "employment.hoursPerWeek", aliases: ["hours per week", "weekly hours"], type: "text" },
  // Part 2 Item 2: receipt number of the petition filed earlier for the same worker
  { path: "petitioner.previousPetition.receiptNumber", aliases: ["previous petition receipt number"], type: "text" },
  // Part 1 Item 1: the kind of petitioner when "Other" is chosen
  { path: "petitioner.entityTypeOther", aliases: ["other type of petitioner"], type: "text" },
  // Part 4 Item 6: applications filed together with this petition (a box is ticked when the answer is yes)
  { path: "application.concurrentFilings.i485", aliases: ["concurrent filing form i-485"], type: "boolean" },
  { path: "application.concurrentFilings.i131", aliases: ["concurrent filing form i-131"], type: "boolean" },
  { path: "application.concurrentFilings.i765", aliases: ["concurrent filing form i-765"], type: "boolean" },
]);

module.exports = { I140_CANONICAL_FIELDS };
