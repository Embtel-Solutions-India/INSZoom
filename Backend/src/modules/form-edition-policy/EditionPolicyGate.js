// Plan Rule D, "Phase 0 interface": EditionPolicyGate.check(formCode, editionIdentifier) -> { allowed, decision, status, reasons }.
//
// ************************************************************************************************************************************************
// RELEASE 0b-1: this gate is NOT wired into any activation / promotion / re-activation / rollback / migration path. It is used only by the evidence
// screen to show what the result WOULD be. Wiring it into every entry point (fail closed) is Release 0b-2 and needs its own approval. A test
// asserts that nothing outside this module imports it.
// ************************************************************************************************************************************************
//
// Conservative rules, evidence-first: a missing record NEVER authorizes anything (no record => held). Looked up by the EXACT edition identifier.
//   accepted (verified, within its review date, no hold, effective, not past its rejection date) -> allowed
//   not_accepted -> blocked outright (no override)     grandfathered -> serve-only, never promote / re-activate / migrate-to
//   held / unverified / stale / conflicting / any error -> held
// Fail closed: ANY error while checking returns held (reason gate_error); the gate never throws and never answers "allowed" by default.

const { GATE_REASONS, EDITION_IDENTIFIER_PATTERN } = require("./editionPolicy.constants");

const result = (allowed, decision, status, reasons, row = null) => ({ allowed, decision, status, reasons, decisionVersion: row?.version ?? null });
const held = (reasons, status = "unverified", row = null) => result(false, "held", status, reasons, row);

/**
 * store.findDecision(formCode, editionIdentifier) -> decision row | null   (injected: Mongoose in the app, an in-memory fake in tests)
 */
async function check(formCode, editionIdentifier, { store, now = new Date() } = {}) {
  try {
    if (!formCode || typeof formCode !== "string" || !EDITION_IDENTIFIER_PATTERN.test(String(editionIdentifier || ""))) return held([GATE_REASONS.INVALID_EDITION]);
    if (!store || typeof store.findDecision !== "function") return held([GATE_REASONS.GATE_ERROR]);
    const row = await store.findDecision(formCode, editionIdentifier);
    if (!row) return held([GATE_REASONS.NO_POLICY]);

    if (row.decision === "not_accepted") return result(false, "not_accepted", row.status || "verified", [GATE_REASONS.NOT_ACCEPTED], row);
    if (row.decision === "grandfathered") return result(false, "grandfathered", row.status || "verified", [GATE_REASONS.GRANDFATHERED], row);
    if (row.decision === "held") return held([GATE_REASONS.HELD, ...(row.holdReason ? [row.holdReason] : [])], row.status || "unverified", row);
    if (row.decision !== "accepted") return held([GATE_REASONS.GATE_ERROR], "unverified", row);

    // accepted: every condition must hold
    const reasons = [];
    if (row.status === "stale") reasons.push(GATE_REASONS.STALE);
    else if (row.status === "conflicting") reasons.push(GATE_REASONS.CONFLICTING);
    else if (row.status !== "verified") reasons.push(GATE_REASONS.UNVERIFIED);
    if (row.holdReason) reasons.push(GATE_REASONS.HELD);
    const at = new Date(now).getTime();
    if (row.reviewBy && at > new Date(row.reviewBy).getTime()) reasons.push(GATE_REASONS.STALE);
    if (row.effectiveDate && at < new Date(row.effectiveDate).getTime()) reasons.push(GATE_REASONS.NOT_YET_EFFECTIVE);
    if (row.rejectionDate) {
      const stopsAt = Math.max(new Date(row.rejectionDate).getTime(), row.graceUntil ? new Date(row.graceUntil).getTime() : 0);
      if (at > stopsAt) {
        // no longer accepted by USCIS: blocked outright, same as an explicit not_accepted
        return result(false, "not_accepted", row.status || "verified", [GATE_REASONS.NO_LONGER_ACCEPTED], row);
      }
    }
    if (reasons.length) return held([...new Set(reasons)], row.status === "conflicting" ? "conflicting" : row.status === "stale" || reasons.includes(GATE_REASONS.STALE) ? "stale" : "unverified", row);
    return result(true, "accepted", "verified", [], row);
  } catch {
    // fail closed: an error is never an "allowed"
    return held([GATE_REASONS.GATE_ERROR]);
  }
}

module.exports = { check };
