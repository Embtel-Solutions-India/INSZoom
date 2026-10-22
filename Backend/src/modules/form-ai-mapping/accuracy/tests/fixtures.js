// Synthetic golden sets and suggestions for the accuracy-gate tests. Nothing here is real form data.
const FAMILIES = {
  employment: ["E1", "E2", "E3"],
  family: ["F1", "F2", "F3"],
  single: ["S1", "S2", "I-90"], // I-90 is the held-out form of the synthetic draft
};
const OWNER = { employment: "petitioner", family: "petitioner", single: "beneficiary" };

/**
 * A draft + reviews + a PERFECT set of suggestions: per form, `text` text boxes (auto-used, correct), and `others` boxes of each of checkbox / dropdown / date (needs_review, correct path).
 * Returns { draft, reviews, suggestionsByForm, entries } so a test can then break exactly one thing.
 */
function build({ text = 110, others = 9, families = FAMILIES, heldOutForms = ["I-90"] } = {}) {
  const entries = [];
  const suggestionsByForm = {};
  let n = 0;
  for (const [family, forms] of Object.entries(families)) {
    for (const formCode of forms) {
      suggestionsByForm[formCode] = [];
      const kinds = [["text", text], ["checkbox", others], ["dropdown", others], ["date", others]];
      for (const [kind, count] of kinds) {
        for (let i = 0; i < count; i += 1) {
          n += 1;
          const targetFieldId = `${formCode}.f${n}`;
          const sourcePath = `${OWNER[family]}.field${n}`;
          entries.push({ id: `e${n}`, formCode, family, boxKind: kind, contentHash: `h${n}`, technical: { targetFieldId, sourcePath } });
          suggestionsByForm[formCode].push({ targetFieldId, candidate: { path: sourcePath }, tier: kind === "text" ? "auto_use" : "needs_review" });
        }
      }
    }
  }
  const draft = { entries, heldOutForms, entriesChecksum: "golden-checksum-1" };
  const reviews = entries.map((entry) => ({ entryId: entry.id, contentHash: entry.contentHash, verdict: "right" }));
  return { draft, reviews, suggestionsByForm, entries };
}

const suggestionFor = (suggestionsByForm, entry) => suggestionsByForm[entry.formCode].find((item) => item.targetFieldId === entry.technical.targetFieldId);

module.exports = { build, suggestionFor, FAMILIES };
