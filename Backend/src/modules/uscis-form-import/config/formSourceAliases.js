// Where USCIS publishes forms whose address is NOT simply https://www.uscis.gov/<form-code> - kept as DATA so a new alias needs no code change.
// Every entry below was verified live (GET, 2026-10-22): the page and/or PDF answered 200 (PDF as application/pdf).
//
//   pageSlugs  paths on www.uscis.gov that are the form's OWN page (e.g. I-485J -> /i-485supj; the code-derived /i-485j is a 404)
//   pdfSlugs   file names under /sites/default/files/document/forms/<slug>.pdf
//   parent     the form code whose page links this form's PDF when the form has no page of its own (I-539A -> I-539)
//
// A code with no entry here still gets the generic derivation in SourceResolver (dash / no-dash, supplement pattern, parent without the letter suffix).

const ALIASES = Object.freeze({
  "I-485J": { pageSlugs: ["i-485supj"], pdfSlugs: ["i-485supj"], parent: "I-485" },
  "I-485A": { pageSlugs: ["i-485supa"], pdfSlugs: ["i-485supa"], parent: "I-485" },
  "I-539A": { pageSlugs: [], pdfSlugs: ["i-539a"], parent: "I-539" },
  "I-130A": { pageSlugs: [], pdfSlugs: ["i-130a"], parent: "I-130" },
  "I-864A": { pageSlugs: ["i-864a"], pdfSlugs: ["i-864a"], parent: "I-864" },
  "I-918SUPA": { pageSlugs: [], pdfSlugs: ["i-918supa"], parent: "I-918" },
  "I-918SUPB": { pageSlugs: [], pdfSlugs: ["i-918supb"], parent: "I-918" },
  "I-131A": { pageSlugs: ["i-131a"], pdfSlugs: ["i-131a"], parent: "I-131" },
  // the G-845 Supplement: its own page (uscis.gov/g-845-supplement) and file (g-845sup.pdf); written "G-845 Supplement", "G-845 Sup" or "G-845SUPPLEMENT" it is one form
  "G-845SUP": { pageSlugs: ["g-845-supplement"], pdfSlugs: ["g-845sup"], parent: "G-845" },
  // I-854 has no form of its own: its page (uscis.gov/i-854) offers Form I-854A and Form I-854B - see PARENT_ONLY
  "I-854A": { pageSlugs: ["i-854"], pdfSlugs: ["i-854a"], parent: "I-854" },
  "I-854B": { pageSlugs: ["i-854"], pdfSlugs: ["i-854b"], parent: "I-854" },
});

// Form codes USCIS lists as ONE page / row but publishes ONLY as lettered forms (the page of "I-854" offers Form I-854A and Form I-854B; there is no Form I-854). Such a code is never fetched or
// stored as a form of its own - the pipeline fetches its lettered forms instead. Kept as DATA: a new family needs one line here and no code change.
const PARENT_ONLY = Object.freeze({
  "I-854": ["I-854A", "I-854B"],
});

/** The lettered forms of a parent-only code ("I-854", "i-854" -> ["I-854A", "I-854B"]), or null when the code is an ordinary form. */
function parentOnlyChildren(formCode) {
  const compact = String(formCode || "").toUpperCase().replace(/\s+/g, "");
  return PARENT_ONLY[compact] ? [...PARENT_ONLY[compact]] : null;
}

/** "I-485 Supplement J" / "I-485 SUPPLEMENT J" / "i-485j" -> the key used above ("I-485SUPJ" is folded to the lettered form where an entry exists). */
function aliasKey(formCode) {
  const compact = String(formCode || "").toUpperCase().replace(/\s+/g, "").replace(/SUPPLEMENT|SUPP\.?|SUP\./g, "SUP");
  if (ALIASES[compact]) return compact;
  const withoutSup = compact.replace(/^([A-Z]{1,3}-\d{2,4})SUP([A-Z0-9]{1,2})$/, "$1$2");
  if (ALIASES[withoutSup]) return withoutSup;
  const asSup = compact.replace(/^([A-Z]{1,3}-\d{2,4})([A-Z])$/, "$1SUP$2");
  return ALIASES[asSup] ? asSup : null;
}

const aliasFor = (formCode) => {
  const key = aliasKey(formCode);
  return key ? { key, ...ALIASES[key] } : null;
};

/** The form's own page when the alias data knows it, else null (callers fall back to the code-derived address). */
const pageUrlFor = (formCode) => {
  const alias = aliasFor(formCode);
  return alias?.pageSlugs?.length ? `https://www.uscis.gov/${alias.pageSlugs[0]}` : null;
};

module.exports = { ALIASES, PARENT_ONLY, parentOnlyChildren, aliasKey, aliasFor, pageUrlFor };
