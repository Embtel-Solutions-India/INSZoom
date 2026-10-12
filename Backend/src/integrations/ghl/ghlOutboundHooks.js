const env = require("../../config/env");

// Called with ONE line from the existing add / remove / restore / invite-employee functions, AFTER they have already
// succeeded, so GHL hears about it within seconds. It:
//   - does nothing at all unless the GHL integration is switched on,
//   - never waits (the work happens on a later tick, off the request),
//   - never throws, so it can never change what the user's request does.
// If a hook is ever missed, the periodic sweep (ghlAuxOutbound.sweep) catches it.
function employeeChanged(childId) {
  try {
    if (!env.ghl.enabled || !env.ghl.token || !childId) return;
    setImmediate(() => {
      try {
        require("./ghlAuxOutbound")
          .enqueueForChild(childId)
          .catch(() => {});
      } catch {
        /* never affects the caller */
      }
    });
  } catch {
    /* never affects the caller */
  }
}

// Automated test runs (node --test) create and save cases all the time; they must never queue pushes to a real GHL account.
const underTestRunner = () => process.env.NODE_ENV === "test" || Boolean(process.env.NODE_TEST_CONTEXT);

// A case was just created (or its visa was just chosen). Queues its GHL card / employer link in the background so the
// request that created it returns at once; failures retry in the job worker and the periodic sweep. Same guarantees as above.
function caseSaved(caseId) {
  try {
    if (!env.ghl.enabled || !env.ghl.token || !caseId || underTestRunner()) return;
    setImmediate(() => {
      try {
        require("./ghlCaseOutbound")
          .enqueueForCase(caseId)
          .catch(() => {});
      } catch {
        /* never affects the caller */
      }
    });
  } catch {
    /* never affects the caller */
  }
}

module.exports = { employeeChanged, caseSaved };
