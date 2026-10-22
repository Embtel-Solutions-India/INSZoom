// Phase 7.7 - two old records land on ONE box of the new edition with different values. PURE.
//
// Provenance rank never settles a conflict between two value-bearing answers (two different addresses, dates or names): picking one would produce a wrong client form
// while "technically keeping" the other. The only automatic merge is the one that provably loses nothing a person decided:
//   - equal values                                        -> merge (the same answer twice)
//   - ONE person-sourced (typed / overridden / verified) value, and every other differing value was derived by the system itself (proven autofill)
//                                                         -> the person's value is kept; the system's value is archived next to it (both recoverable)
// Everything else (two different person-sourced values, two different system values, a value of unknown origin) is PARKED: the case form stays untouched on its old
// edition, which keeps working, until the rules or the matcher improve (re-evaluated automatically: see parkRecord / isParkCurrent).
const ValueRules = require("./ValueRules");

const canonicalOf = (value) => JSON.stringify(value === undefined ? null : value);

/**
 * `items` = the group's real (non-blank) answers: [{ path, value, kind: { userSourced, verified, provenAutofill, unknownProvenance } }].
 * Returns { action: "merge", winner, reason } | { action: "park", reason }.
 */
function decide(items) {
  const distinct = new Set(items.map((item) => canonicalOf(item.value)));
  if (distinct.size <= 1) return { action: "merge", winner: items.find((item) => item.kind.userSourced) || items[0], reason: "equal_values" };
  const person = items.filter((item) => item.kind.userSourced || item.kind.verified);
  const personValues = new Set(person.map((item) => canonicalOf(item.value)));
  const rest = items.filter((item) => !person.includes(item));
  if (person.length && personValues.size === 1 && rest.every((item) => item.kind.provenAutofill && !item.kind.unknownProvenance)) {
    return { action: "merge", winner: person.find((item) => item.kind.userSourced) || person[0], reason: "person_value_over_system_value" };
  }
  if (person.length > 1 && personValues.size > 1) return { action: "park", reason: "two_different_person_values" };
  if (!person.length) return { action: "park", reason: "two_different_system_values" };
  return { action: "park", reason: "value_of_unknown_origin_differs" };
}

/** What is stored on a parked case form so it is never re-planned in a loop and is re-evaluated when something relevant changes. */
function parkRecord({ unresolved, toTemplateId, updatedAt, matcherVersion = 0, rulesVersion = ValueRules.RULES_VERSION, now = new Date() }) {
  return {
    parkedAt: now,
    toTemplateId,
    updatedAtAtPark: updatedAt ? new Date(updatedAt).getTime() : null,
    matcherVersion,
    rulesVersion,
    // codes and keys only: the answers themselves stay where they are (on this very case form, untouched)
    unresolved: (unresolved || []).slice(0, 50).map((item) => ({ code: item.code, bag: item.bag, targetId: item.targetId, oldKeys: item.oldKeys, reason: item.reason, policy: item.policy })),
    releaseConditions: ["the case form's answers change (a person resolves the difference)", "the matcher or the migration rules are improved (re-evaluated automatically)"],
  };
}

/** True while a park decision is still valid: same target edition, same rules and matcher, and nobody edited the case form since. Then no re-plan is needed. */
function isParkCurrent(parked, { toTemplateId, updatedAt, matcherVersion = 0, rulesVersion = ValueRules.RULES_VERSION }) {
  if (!parked || !parked.parkedAt) return false;
  return String(parked.toTemplateId) === String(toTemplateId)
    && Number(parked.rulesVersion) === Number(rulesVersion)
    && Number(parked.matcherVersion) === Number(matcherVersion)
    && parked.updatedAtAtPark === (updatedAt ? new Date(updatedAt).getTime() : null);
}

module.exports = { decide, parkRecord, isParkCurrent };
