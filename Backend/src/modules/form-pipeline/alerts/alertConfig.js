// Phase 5E: the noise-control switches of the developer e-mails (plan "Developer email notifications" - "Noise control and config"). Pure: reads the environment, touches nothing.
//
//   FORM_PIPELINE_EMAIL_FAILURE=true|false   failure / blocked / dead-letter e-mails (off => the admins get an in-app notice instead)          default true
//   FORM_PIPELINE_EMAIL_HELD=true|false      held / approval-required e-mails (off => in-app notice instead)                                    default true
//   FORM_PIPELINE_EMAIL_SUCCESS=true|false   "edition promoted" e-mails and digests (off => nothing is sent, no in-app notice either)            default true
//   FORM_PIPELINE_EMAIL_MODE=auto|individual|digest   how successes are sent                                                                    default auto
//        auto        scheduled / catalog-wide runs (catalog_sync, autopilot, edition_upgrade, script) -> ONE digest; on-demand runs -> one e-mail each
//        individual  every success is its own e-mail (until the per-run cap, the rest go to the digest)
//        digest      every success goes to the digest
//   FORM_PIPELINE_EMAIL_RUN_CAP=<n>          most individual success e-mails per run window before the rest go to the digest (0 = none)          default 5
//   FORM_PIPELINE_DIGEST_QUIET_MINUTES=<n>   a digest is sent once no new success has been added for this long                                   default 10
//   FORM_PIPELINE_ALERT_EMAIL                recipients (comma-separated), see PipelineAlerter
//   FORM_PIPELINE_DIGEST_FLUSHER=false       do not run the in-process digest flusher in this process
// Failures, held and dead-letter are NEVER batched into a digest: they are individual e-mails (deduped per job).
const SCHEDULED_TRIGGERS = Object.freeze(["catalog_sync", "autopilot", "edition_upgrade", "script"]);
const MODES = Object.freeze(["auto", "individual", "digest"]);
const DEFAULTS = Object.freeze({ runCap: 5, quietMinutes: 10 });

function flag(value, fallback = true) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return !["false", "0", "off", "no"].includes(String(value).trim().toLowerCase());
}

const emailFlags = (env = process.env) => ({ failure: flag(env.FORM_PIPELINE_EMAIL_FAILURE), held: flag(env.FORM_PIPELINE_EMAIL_HELD), success: flag(env.FORM_PIPELINE_EMAIL_SUCCESS) });
/** Phase 7.E: the stuck-forms e-mail has its own switch (kept out of emailFlags so that object keeps its shape). */
const stuckEmailEnabled = (env = process.env) => flag(env.FORM_PIPELINE_EMAIL_STUCK);

// Phase 7.E (B8): the "forms stuck after all efforts" e-mail.
//   DEVELOPER_EMAIL=<a>,<b>                  who receives it (comma-separated); falls back to FORM_PIPELINE_ALERT_EMAIL, then the alerter's default address
//   FORM_PIPELINE_EMAIL_STUCK=true|false     off => the admins get an in-app notice instead                                                      default true
//   FORM_PIPELINE_STUCK_REMINDER_HOURS=<n>   an unchanged set of stuck forms is e-mailed again after this long                                   default 24
const splitList = (value) => String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
/** The developer addresses for the stuck e-mail: DEVELOPER_EMAIL, else FORM_PIPELINE_ALERT_EMAIL, else `fallback` (the alerter's default). Never empty when a fallback is given. */
function developerRecipients(env = process.env, fallback = "") {
  const first = splitList(env.DEVELOPER_EMAIL);
  if (first.length) return first;
  const second = splitList(env.FORM_PIPELINE_ALERT_EMAIL);
  if (second.length) return second;
  return splitList(fallback);
}
const stuckReminderMs = (env = process.env) => {
  const parsed = Number.parseFloat(env.FORM_PIPELINE_STUCK_REMINDER_HOURS);
  return (Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 24 * 30) : 24) * 60 * 60 * 1000;
};

function emailMode(env = process.env) {
  const value = String(env.FORM_PIPELINE_EMAIL_MODE || "auto").trim().toLowerCase();
  return MODES.includes(value) ? value : "auto";
}

function wholeNumber(value, fallback, { min = 0, max = 100000 } = {}) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= min ? Math.min(parsed, max) : fallback;
}

const runCap = (env = process.env) => wholeNumber(env.FORM_PIPELINE_EMAIL_RUN_CAP, DEFAULTS.runCap);
const digestQuietMs = (env = process.env) => wholeNumber(env.FORM_PIPELINE_DIGEST_QUIET_MINUTES, DEFAULTS.quietMinutes, { min: 1, max: 24 * 60 }) * 60 * 1000;
const flusherEnabled = (env = process.env) => flag(env.FORM_PIPELINE_DIGEST_FLUSHER);
const isScheduledTrigger = (trigger) => SCHEDULED_TRIGGERS.includes(trigger);

/** "digest" or "individual": where a SUCCESS of a run started by `trigger` goes first (the per-run cap can still turn an individual into a digest entry). */
function successRoute({ trigger, env = process.env } = {}) {
  const mode = emailMode(env);
  if (mode === "digest") return "digest";
  if (mode === "individual") return "individual";
  return isScheduledTrigger(trigger) ? "digest" : "individual";
}

/** One digest window per trigger so a catalog sync and an autopilot run are summarized separately. */
const digestKey = (trigger) => `success:${trigger || "unknown"}`;

module.exports = { developerRecipients, stuckReminderMs, stuckEmailEnabled, SCHEDULED_TRIGGERS, MODES, DEFAULTS, flag, emailFlags, emailMode, runCap, digestQuietMs, flusherEnabled, isScheduledTrigger, successRoute, digestKey };
