// Release 0b-2: the 12-hourly background check belongs to THIS subsystem. The catalog-sync job (USCISCatalogSyncJob) imports new / changed editions; right after
// it, it calls runScheduledEditionChecks(), which asks the official USCIS page about every edition on file through the same automatic check the Admin
// "Check now" button and the activation gate use (EvidenceService.runAutomaticCheck). The job has no acceptance logic of its own.
//
// Like the pipeline-triggered check it only does anything when FORM_EDITION_AUTO_EVIDENCE=true (default off), because a recorded decision is a write.
// Each edition is checked on its own: a failure for one (page unreachable, ...) never stops the others, and nothing here can activate or change a form.

const { editionOf } = require("./EditionPolicyEnforcer");

const logger = () => require("../../utils/logger");

const ACTIVE_OR_PENDING = new Set(["active", "review", "draft", "pending_review"]);

function defaultDeps() {
  return {
    service: require("./EvidenceService").getService(),
    store: require("./EditionPolicyStore").mongoStore,
    enabled: process.env.FORM_EDITION_AUTO_EVIDENCE === "true",
  };
}

/** Resolves with { enabled, checked, tally } and never throws. */
async function runScheduledEditionChecks(overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  if (!deps.enabled) return { enabled: false, checked: 0, tally: {} };
  const tally = {};
  let checked = 0;
  try {
    const seen = new Set();
    for (const template of await deps.store.listTemplates()) {
      if (!ACTIVE_OR_PENDING.has(template.status)) continue;
      const edition = editionOf(template);
      if (!edition.editionIdentifier) continue; // no trusted edition date: nothing to ask USCIS about
      const key = `${edition.formCode}|${edition.editionIdentifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      let outcome;
      try {
        outcome = (await deps.service.runAutomaticCheck(edition.formCode, edition.editionIdentifier, { trigger: "scheduled_sync" })).outcome;
      } catch (error) {
        outcome = "error";
        logger().warn("form_edition_scheduled_check_failed", { formCode: edition.formCode, edition: edition.editionIdentifier, error: error.message });
      }
      tally[outcome] = (tally[outcome] || 0) + 1;
      checked += 1;
    }
  } catch (error) {
    logger().warn("form_edition_scheduled_checks_failed", { error: error.message });
  }
  logger().info("form_edition_scheduled_checks", { checked, tally });
  return { enabled: true, checked, tally };
}

module.exports = { runScheduledEditionChecks };
