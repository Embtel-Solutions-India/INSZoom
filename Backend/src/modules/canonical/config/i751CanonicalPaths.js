// Canonical facts Form I-751 asks about the spouse / former spouse that no earlier checklist stored. Same extension mechanism as i864CanonicalPaths.js: a path only
// has to be REGISTERED here and wired to its box in form-mapping/config/i751FieldRules.js (a checklist question can then feed it through question.mapping.canonicalPath).
const I751_CANONICAL_FIELDS = Object.freeze([
  // Part 1 Item 13: the date the marriage ended (divorce / annulment / death)
  { path: "petitioner.marriageEndDate", aliases: ["date marriage ended"], type: "date" },
  // Part 4 (spouse or former spouse): identity numbers and the U.S. ZIP code of the address
  { path: "petitioner.currentSpouse.ssn", aliases: ["spouse social security number"], type: "text" },
  { path: "petitioner.currentSpouse.aNumber", aliases: ["spouse a-number"], type: "text" },
  { path: "petitioner.currentSpouse.address.zip", aliases: ["spouse zip code"], type: "text" },
]);

module.exports = { I751_CANONICAL_FIELDS };
