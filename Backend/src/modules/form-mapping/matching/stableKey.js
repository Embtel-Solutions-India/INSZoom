// Phase 7.3: the STABLE KEY of a PDF field - an identity that survives a new edition's layout shifts. It is built from the fully-qualified PDF name WITHOUT the
// subform / page-set containers (USCIS renumbers `#subform[n]` when a page is inserted) and the field's group, never from its scan order. It is ADDITIVE: it is used
// for matching only; no existing `fieldId` is ever derived from it or replaced by it (that would orphan saved answers). Pure.
const crypto = require("crypto");

/** `form1[0].#subform[3].Pt2Line3a_FamilyName[0]` -> `form1[0].pt2line3a_familyname[0]` (containers removed, case folded, field indexes kept). */
function qualifiedName(rawName) {
  return String(rawName ?? "")
    .replace(/#(?:subform|pageSet|page)\[\d+\]\./gi, "")
    .replace(/\.(?:Page\d+)\[\d+\]/gi, "")
    .trim()
    .toLowerCase();
}

/** The same name with every `[n]` index removed (the "kind" of field, shared by all repeats of it). */
const indexlessName = (rawName) => qualifiedName(rawName).replace(/\[\d+\]/g, "");

function stableKeyOf(rawName, group = "") {
  const name = qualifiedName(rawName);
  if (!name) return null;
  return crypto.createHash("sha1").update(`${name}|${String(group ?? "").toLowerCase()}`).digest("hex").slice(0, 20);
}

/** The scanner's group id, but only when it names a printed line (`part1.line4`); a group derived from containers (`page1.form10PageSet0...`) changes with every page insertion and is dropped. */
const stableGroupOf = (group) => (/^(?:part|page|supplement)[a-z0-9]*\.line[a-z0-9]+$/i.test(String(group || "")) ? String(group).toLowerCase() : "");

module.exports = { qualifiedName, indexlessName, stableKeyOf, stableGroupOf };
