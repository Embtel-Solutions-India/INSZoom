// Canonical facts Form I-864 asks that no earlier checklist stored. Same extension mechanism as i140CanonicalPaths.js: a path only has to be REGISTERED
// here and wired to its box in form-mapping/config/i864FieldRules.js (a checklist question can then feed it through question.mapping.canonicalPath).
const I864_CANONICAL_FIELDS = Object.freeze([
  // Part 4 Item 5: the country where the sponsor is domiciled
  { path: "petitioner.countryOfDomicile", aliases: ["country of domicile"], type: "text" },
]);

module.exports = { I864_CANONICAL_FIELDS };
