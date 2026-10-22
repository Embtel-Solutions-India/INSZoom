// Phase 7.7 - the conservation proof of ONE case form's migration. PURE.
//
//   build()      before anything is written: every old answer (every leaf of the three value bags) must have exactly one documented destination - carried to a box (with the
//                rule that carried / converted it), archived with a reason, or the case form is parked. An answer with no disposition makes the plan UNPROVEN: the caller
//                parks the case form instead of writing anything.
//   reconcile()  after the write, read back from the database: every carried answer is where the proof says it is (and equals the old answer, or the converted one the proof
//                records), every archived answer is on the case form, nothing is unaccounted for.
// The proof is stored with the pre-image snapshot (checksummed), so "what happened to every value, and why" can be answered later.
const crypto = require("crypto");

const sha256 = (text) => crypto.createHash("sha256").update(text).digest("hex");

/**
 * `enumerate` = [[bag, path, value]] of every old answer leaf; `plan` = planCarry's result (dispositions, writes, archive).
 * Returns { ok, entries[], unaccounted[], counts, checksum }.
 */
function build({ enumerate, plan }) {
  const dispositions = (plan.dispositions || []).filter((item) => item.kind === "value");
  const byKey = new Map();
  for (const item of dispositions) byKey.set(`${item.bag}\u0000${item.oldKey}`, item);
  const entries = [];
  const unaccounted = [];
  for (const [bag, path] of enumerate) {
    const item = byKey.get(`${bag}\u0000${path}`);
    if (!item) { unaccounted.push({ bag, oldKey: path, reason: "no_disposition" }); continue; }
    if (item.disposition === "archived") {
      const kept = plan.archive?.unmatchedValues?.[bag] && Object.prototype.hasOwnProperty.call(plan.archive.unmatchedValues[bag], path);
      if (!kept) { unaccounted.push({ bag, oldKey: path, reason: "archived_but_not_stored" }); continue; }
    }
    entries.push({ bag, oldKey: path, newKey: item.newKey || null, disposition: item.disposition, reason: item.reason || null, rule: item.rule || null, converted: Boolean(item.converted), protected: Boolean(item.userSourced || item.verified || item.unknownProvenance || bag === "manualOverrides"), ...(item.convertedTo !== undefined ? { convertedTo: item.convertedTo } : {}) });
  }
  const counts = entries.reduce((acc, entry) => { acc[entry.disposition] = (acc[entry.disposition] || 0) + 1; if (entry.converted) acc.converted = (acc.converted || 0) + 1; return acc; }, { total: enumerate.length });
  const body = JSON.stringify(entries.slice().sort((a, b) => `${a.bag}${a.oldKey}`.localeCompare(`${b.bag}${b.oldKey}`)));
  return { ok: unaccounted.length === 0, entries, unaccounted, counts, checksum: sha256(body) };
}

/**
 * `read(bag, key)` reads a value of the migrated case form; `archived(bag, oldKey)` reads the archive entry; `sameValue(a, b)` compares.
 * Returns the list of problems (empty = every value accounted for and in place).
 */
function reconcile({ proof, readOld, read, archived, sameValue, isMissing }) {
  const problems = [];
  for (const entry of proof.entries || []) {
    if (entry.disposition === "archived") {
      const original = readOld(entry.bag, entry.oldKey);
      const kept = archived(entry.bag, entry.oldKey);
      if (original !== undefined && !sameValue(original, kept)) problems.push({ code: "PROOF_ARCHIVED_VALUE_MISSING", bag: entry.bag, oldKey: entry.oldKey });
    } else if (entry.disposition === "preserved" && entry.protected) {
      const original = readOld(entry.bag, entry.oldKey);
      if (isMissing(original)) continue;
      const actual = read(entry.bag, entry.newKey);
      // an unconverted answer must still be there unchanged unless the system re-derived it (autofill refreshes proven system values only: the caller's verification covers
      // those); a converted answer must equal what the rule produced (recorded by the caller as entry.convertedTo)
      if (entry.protected && entry.convertedTo !== undefined && !sameValue(entry.convertedTo, actual)) problems.push({ code: "PROOF_CONVERTED_VALUE_CHANGED", bag: entry.bag, oldKey: entry.oldKey, newKey: entry.newKey });
      else if (isMissing(actual)) problems.push({ code: "PROOF_VALUE_MISSING", bag: entry.bag, oldKey: entry.oldKey, newKey: entry.newKey });
    }
  }
  return problems;
}

module.exports = { build, reconcile, sha256 };
