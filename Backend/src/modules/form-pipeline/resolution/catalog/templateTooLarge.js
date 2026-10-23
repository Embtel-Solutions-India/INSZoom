// The template document is over the 16 MB MongoDB limit. Shrinking is verified by the stage (a round-trip read); storage changes need the owner approval (D5).
const { depStrategy } = require("./_helpers");

module.exports = {
  id: "templateTooLarge",
  description: "the template document exceeds the database document limit",
  matches: (diagnosis) => diagnosis.cause === "template_too_large",
  strategies: [
    depStrategy({ id: "drop_duplicate_structures", description: "store the field structure once instead of several times", depName: "shrinkTemplate" }),
    depStrategy({ id: "externalize_largest", description: "move the largest field block to object storage", depName: "externalizeLargest" }),
  ],
};
