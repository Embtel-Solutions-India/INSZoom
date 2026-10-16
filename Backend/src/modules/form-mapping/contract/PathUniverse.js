// Which canonical source paths can actually be resolved when a form is autofilled ("the LIVE registry", plan Phase 2). A path is known when it is
//   registry        - in CanonicalFieldRegistryService (every base / checklist / party registry file)
//   alias           - one of the generic party paths PartyAliasService fills (beneficiary.* / petitioner.*)
//   profile         - a canonical path the employer / employee profile maps produce
//   library         - the canonicalPath of an active question-library item
//   rule            - a path the authored party rules (config/partyFieldRules) read: the verified rules are themselves the proof the path is populated
//   raw             - raw.* (questionnaire answers are looked up by key at fill time)
//   ancestor        - a child of a registered path (beneficiary.usMailingAddress.line1 under the registered address object beneficiary.usMailingAddress)
// Array / wildcard notation (`[]`, `[0]`, `*`) is reduced to its base before the lookup. Calibrated against the 1,404 live edges: every one resolves.
const normalizePath = (path) => String(path || "").trim().replace(/\[(?:\d+|\*)?\]/g, "").replace(/\.\*$/, "").replace(/\*/g, "");

/**
 * @param sources { registry: [{ path, type, role?, cardinality?, description? }], alias: [path], profile: [path], library: [path], rules: [path] }
 * @returns { check(path) -> { known, via, exact, entry? }, size }
 */
function createPathUniverse({ registry = [], alias = [], profile = [], library = [], rules = [] } = {}) {
  const entries = new Map();
  const add = (path, via, entry) => { if (path && !entries.has(path)) entries.set(path, { via, entry }); };
  registry.forEach((entry) => add(entry.path, "registry", entry));
  alias.forEach((path) => add(path, "alias"));
  profile.forEach((path) => add(path, "profile"));
  library.forEach((path) => add(path, "library"));
  rules.forEach((path) => add(path, "rule"));

  function check(rawPath) {
    const original = String(rawPath || "").trim();
    if (!original) return { known: false, via: null, exact: false };
    if (/^raw\./.test(original)) return { known: true, via: "raw", exact: false };
    const path = normalizePath(original);
    const direct = entries.get(path);
    if (direct) return { known: true, via: direct.via, exact: true, entry: direct.entry };
    const parts = path.split(".");
    for (let length = parts.length - 1; length >= 1; length -= 1) {
      const ancestor = entries.get(parts.slice(0, length).join("."));
      if (ancestor) return { known: true, via: "ancestor", exact: false, entry: ancestor.entry };
    }
    return { known: false, via: null, exact: false };
  }

  return { check, size: entries.size, has: (path) => check(path).known };
}

let cached = null;
let cachedAt = 0;
const CACHE_MS = 10 * 60 * 1000;

/** The live universe: the registry files, party aliases and profile maps (static) plus the question library's canonical paths (read from the database, cached). */
async function loadPathUniverse({ force = false, libraryPaths } = {}) {
  if (!force && cached && Date.now() - cachedAt < CACHE_MS && !libraryPaths) return cached;
  const Registry = require("../services/CanonicalFieldRegistryService");
  const Alias = require("../../canonical/services/PartyAliasService");
  const profileMap = require("../../canonical/config/profileCanonicalMap");
  const walk = (object, out = []) => {
    for (const value of Object.values(object || {})) {
      if (typeof value === "string" && value.includes(".")) out.push(value);
      else if (value && typeof value === "object") walk(value, out);
    }
    return out;
  };
  let library = libraryPaths;
  if (!library) {
    try {
      library = (await require("../../../models/QuestionLibraryItem").distinct("canonicalPath", { active: true })).filter(Boolean);
    } catch {
      library = []; // the database is unreachable: static sources only (never a reason to fail the caller)
    }
  }
  // every path an authored party rule reads: its target path, a fallback, the paths of a transform and the collection of an arrayItem
  const rulePaths = new Set();
  try {
    const { RULES } = require("../config/partyFieldRules");
    for (const rules of Object.values(RULES)) {
      for (const rule of rules) {
        [rule.to, rule.fallback, rule.transform?.collection, ...(rule.transform?.fields || [])].filter((path) => typeof path === "string" && path).forEach((path) => rulePaths.add(path));
      }
    }
  } catch {
    // the rules file is optional input: without it the other sources still apply
  }
  const universe = createPathUniverse({
    registry: Registry.list(),
    alias: [...Alias.BENEFICIARY_SOURCES, ...Alias.PETITIONER_SOURCES].flat(),
    profile: [...walk(profileMap.EMPLOYER_PROFILE_TO_CANONICAL), ...walk(profileMap.EMPLOYEE_PROFILE_TO_CANONICAL)],
    library,
    rules: [...rulePaths],
  });
  if (!libraryPaths) { cached = universe; cachedAt = Date.now(); }
  return universe;
}

module.exports = { createPathUniverse, loadPathUniverse, normalizePath };
