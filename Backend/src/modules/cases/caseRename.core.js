// Pure helpers for renaming a case (no database, no side effects) - see caseRename.service.js for the orchestration.
//
// A case's name lives in many places: the case itself, questionnaire answers, the canonical profile that fills USCIS forms, the linked accounts and records. Rather
// than a fixed list of paths (which differs by case type and by how far the client got), every structure is walked and the OLD name is replaced wherever it appears
// as a whole value, and a person's first / middle / last name fields are replaced only on an object whose first + last name belong to the person being renamed.
// A different person with a similar name (a spouse, a past employer) is never touched, and history (timelines, audit trails, past emails) is never rewritten.

const MAX_NAME_LENGTH = 120;

/** Collapse spaces and lower-case: the whole-value comparison ("  SAI Foods  LLC " equals "sai foods llc"). */
const fold = (value) => String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** Letters and digits only, lower-cased: tolerant comparison of a person's name parts ("Hanqi 'Dylan'" ~ "hanqi dylan"). */
const norm = (value) => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const clean = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();

const isPlain = (value) => value !== null && typeof value === "object" && (Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);

const FIRST_KEYS = ["firstName", "givenName"];
const LAST_KEYS = ["lastName", "familyName"];
const MIDDLE_KEYS = ["middleName"];

/** "Given Middle Family" - the way a person's display name is composed from their parts. */
const composeFullName = ({ firstName, middleName, lastName } = {}) => [clean(firstName), clean(middleName), clean(lastName)].filter(Boolean).join(" ");

/** A best-effort split of a full name into parts, to pre-fill the edit form (the first word, the last word, anything between). Never used to rewrite data on its own. */
function splitName(fullName) {
  const words = clean(fullName).split(" ").filter(Boolean);
  if (words.length <= 1) return { firstName: words[0] || "", middleName: "", lastName: "" };
  return { firstName: words[0], middleName: words.slice(1, -1).join(" "), lastName: words[words.length - 1] };
}

/**
 * Validates what the team typed. A company (employer) takes one name; a person takes a first and last name (and an optional middle name).
 * Returns { error } or { name, parts } where `name` is the new display name and `parts` the person's parts (null for a company).
 */
function validateNameInput(input = {}, { kind } = {}) {
  if (kind === "company") {
    const name = clean(input.name);
    if (!name) return { error: "Enter the company name." };
    if (name.length > MAX_NAME_LENGTH) return { error: `The name can be at most ${MAX_NAME_LENGTH} characters.` };
    return { name, parts: null };
  }
  const parts = { firstName: clean(input.firstName), middleName: clean(input.middleName), lastName: clean(input.lastName) };
  if (!parts.firstName && !parts.lastName && clean(input.name)) {
    // only a full name was sent: split it
    Object.assign(parts, splitName(input.name));
  }
  if (!parts.firstName) return { error: "Enter the first name." };
  if (!parts.lastName) return { error: "Enter the last name." };
  const name = composeFullName(parts);
  if (name.length > MAX_NAME_LENGTH) return { error: `The name can be at most ${MAX_NAME_LENGTH} characters.` };
  return { name, parts };
}

/** Whole-word, case-insensitive replacement inside a longer text ("ABC Inc, John Smith" -> "ABC Inc, Jon Smyth"). */
function replaceInText(text, oldName, newName) {
  if (typeof text !== "string" || !oldName) return { value: text, changed: false };
  const escaped = String(oldName).trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const next = text.replace(new RegExp(escaped, "gi"), () => newName);
  return { value: next, changed: next !== text };
}

/**
 * Does this object hold the first + last name of the person being renamed? (its first name starts the old name and its last name ends it)
 */
function isNamePartsObject(object, oldName) {
  const first = FIRST_KEYS.map((key) => object[key]).find((value) => typeof value === "string" && value.trim());
  const last = LAST_KEYS.map((key) => object[key]).find((value) => typeof value === "string" && value.trim());
  if (!first || !last) return false;
  const old = norm(oldName).split(" ").filter(Boolean);
  if (old.length < 2) return false;
  const firstWords = norm(first).split(" ").filter(Boolean);
  const lastWords = norm(last).split(" ").filter(Boolean);
  if (!firstWords.length || !lastWords.length) return false;
  return old[0] === firstWords[0] && old[old.length - 1] === lastWords[lastWords.length - 1];
}

/**
 * The first / middle / last name the case's own data holds for this person (the first name-parts object that belongs to `oldName`), so the edit form is
 * pre-filled with the real parts instead of a guess from splitting the display name. Returns null when none is found.
 */
function findNameParts(trees, oldName) {
  const pick = (object, keys) => keys.map((key) => object[key]).find((value) => typeof value === "string" && value.trim()) || "";
  const search = (node, depth) => {
    if (depth > 12 || !isPlain(node)) return null;
    if (Array.isArray(node)) {
      for (const item of node) { const found = search(item, depth + 1); if (found) return found; }
      return null;
    }
    if (isNamePartsObject(node, oldName)) return { firstName: clean(pick(node, FIRST_KEYS)), middleName: clean(pick(node, MIDDLE_KEYS)), lastName: clean(pick(node, LAST_KEYS)) };
    for (const value of Object.values(node)) { const found = search(value, depth + 1); if (found) return found; }
    return null;
  };
  for (const tree of [].concat(trees)) { const found = search(tree, 0); if (found) return found; }
  return null;
}

/**
 * Walks `tree` (never mutates it) and returns { value, changes } where `value` is a copy with the rename applied and `changes` lists
 * [{ path, from, to }] for every value that changed.
 *   oldName / newName - the display names (whole-value replacement, case and spacing tolerant)
 *   parts             - the new { firstName, middleName, lastName } of a PERSON (null for a company): written to every name-parts object that belongs to the old person
 *   textKeys          - key names whose text may CONTAIN the old name ("Employer, Employee" card names): replaced as a word inside the text
 */
function replaceNames(tree, { oldName, newName, parts = null, textKeys = [] } = {}) {
  const changes = [];
  const oldFold = fold(oldName);
  if (!oldFold || !newName) return { value: tree, changes };
  const textKeySet = new Set(textKeys);

  // `safe` is false once a key on the way contains "." or starts with "$": such a path cannot be addressed in a database update, so the caller skips it
  const walk = (node, path, key, safe) => {
    if (typeof node === "string") {
      if (textKeySet.has(key)) {
        const replaced = replaceInText(node, oldName, newName);
        if (replaced.changed) { changes.push({ path, from: node, to: replaced.value, safe }); return replaced.value; }
        return node;
      }
      if (fold(node) === oldFold) {
        if (node !== newName) changes.push({ path, from: node, to: newName, safe }); // already exactly the new name: nothing to write
        return newName;
      }
      return node;
    }
    if (Array.isArray(node)) return node.map((item, index) => walk(item, path ? `${path}.${index}` : String(index), key, safe));
    if (!isPlain(node)) return node;

    const copy = {};
    const rewriteParts = parts && isNamePartsObject(node, oldName);
    for (const [childKey, childValue] of Object.entries(node)) {
      const childPath = path ? `${path}.${childKey}` : childKey;
      const childSafe = safe && !/[.$]/.test(childKey);
      if (rewriteParts && typeof childValue === "string") {
        let target;
        if (FIRST_KEYS.includes(childKey)) target = parts.firstName;
        else if (LAST_KEYS.includes(childKey)) target = parts.lastName;
        else if (MIDDLE_KEYS.includes(childKey)) target = parts.middleName;
        if (target !== undefined) {
          if (target !== childValue) changes.push({ path: childPath, from: childValue, to: target, safe: childSafe });
          copy[childKey] = target;
          continue;
        }
      }
      copy[childKey] = walk(childValue, childPath, childKey, childSafe);
    }
    // a middle name was entered and this person's data has no middle-name field yet: add it (so the forms can use it)
    if (rewriteParts && parts.middleName && !MIDDLE_KEYS.some((middleKey) => middleKey in node)) {
      copy.middleName = parts.middleName;
      changes.push({ path: path ? `${path}.middleName` : "middleName", from: undefined, to: parts.middleName, safe });
    }
    return copy;
  };

  return { value: walk(tree, "", "", true), changes };
}

/**
 * Is `name` (coming back from GoHighLevel) one of this case's EARLIER names? After a rename the GHL contact / card may still carry the old name for a while;
 * such a stale name must never overwrite the new one. A different name (someone renamed it in GHL on purpose) is not stale and flows in as usual.
 */
function isStaleName(caseDoc, name) {
  const incoming = fold(name);
  if (!incoming) return false;
  const edit = caseDoc?.nameEdit;
  if (!edit?.at) return false;
  return [edit.previousName, ...(edit.previousNames || [])].some((previous) => fold(previous) === incoming);
}

module.exports = { findNameParts, isStaleName, MAX_NAME_LENGTH, fold, norm, clean, composeFullName, splitName, validateNameInput, replaceInText, isNamePartsObject, replaceNames };
