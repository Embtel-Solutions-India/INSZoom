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

module.exports = { employeeChanged };
