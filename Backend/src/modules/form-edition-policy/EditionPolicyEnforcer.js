// Release 0b-2: the ONE function every activation / promotion / re-activation / rollback / case-migration path calls before it changes anything
// (plan Rule C / I, "pipeline only" scope chosen by the user on 2026-10-16). It is fail closed and has NO disable switch:
//   - the edition must have a trusted edition date (never `version`, never version_backfill), otherwise it is held;
//   - if automatic evidence is enabled (FORM_EDITION_AUTO_EVIDENCE=true) the system first runs its own automatic check for this edition;
//   - the gate then answers from the PERSISTED decision only; anything but allowed throws EditionPolicyHeldError BEFORE the caller mutates anything;
//   - ANY error while checking (database down, gate bug, ...) is also a hold: the result of this function is never "allowed by default".
// Callers must not wrap this in a catch that carries on (a test injects a throwing gate at every entry point and asserts nothing is promoted).
// Live editions are not touched: the gate runs when an edition is about to become / return to being the live one, not on editions already serving.
// Rule J (the four filing-ready case steps) is deliberately NOT enforced in this release.

const gate = require("./EditionPolicyGate");
const { GATE_REASONS, OWNER_FOOTER_EDITION_FORMS, OWNER_APPROVED_EDITIONS, familyOf } = require("./editionPolicy.constants");

class EditionPolicyHeldError extends Error {
  constructor({ formCode, editionIdentifier, reasons, entryPoint, decision }) {
    const label = editionIdentifier ? `${formCode} edition ${editionIdentifier}` : `${formCode} (edition date unknown)`;
    super(`USCIS has not confirmed that ${label} is accepted for filing, so it was not activated (${reasons.join(", ")}). Nothing was changed.`);
    this.name = "EditionPolicyHeldError";
    this.status = 409;
    this.code = "EDITION_POLICY_HELD";
    this.details = { formCode, editionIdentifier, reasons, entryPoint, decision };
  }
}

const isoDay = (value) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
};

// tests replace the dependencies; the application uses the real, Mongoose-backed service
let depsOverride = null;
function setDepsForTests(deps) { depsOverride = deps; }
function defaultDeps() {
  const service = require("./EvidenceService").getService();
  return { service, store: require("./EditionPolicyStore").mongoStore, autoEvidence: process.env.FORM_EDITION_AUTO_EVIDENCE === "true" };
}

// the edition date printed in the footers of the template's own stored PDF (ISO day) or null; tests inject deps.footerEdition
async function defaultFooterEdition(template) {
  let key = template?.artifacts?.form?.storageKey || template?.pdfStorageKey;
  // a caller may hand over a partial template (no storage key): the key is read from the stored template itself, so the policy never depends on which fields the caller selected
  if (!key && template?._id) {
    const stored = await require("../../models/USCISFormTemplate").findById(template._id).select("pdfStorageKey artifacts.form.storageKey").lean();
    key = stored?.artifacts?.form?.storageKey || stored?.pdfStorageKey;
  }
  if (!key) return null;
  const buffer = await require("../uploads/storage.service").readBuffer(key);
  return require("../uscis-form-import/services/FormIdentityService").footerEdition(buffer);
}

/**
 * OWNER POLICY (see OWNER_FOOTER_EDITION_FORMS): turns the gate's "no record" answer into allowed for the listed forms when the PDF's own footer edition equals this edition. It
 * never overrides a recorded decision (not accepted / held / stale / conflicting keep blocking) and never applies to a form that is not on the list. Returns the allowed result or null.
 */
async function ownerApprovedEditionAllowed(edition, gateResult) {
  const approved = OWNER_APPROVED_EDITIONS[familyOf(edition.formCode)];
  if (!approved || approved !== edition.editionIdentifier) return null;
  if (gateResult?.allowed || !(gateResult?.reasons || []).length || gateResult.reasons.some((reason) => reason !== GATE_REASONS.NO_POLICY)) return null; // a recorded decision always wins
  return { allowed: true, decision: "accepted", status: "owner_policy", reasons: [], ownerPolicy: "approved_edition", approvedEdition: approved, decisionVersion: null };
}

// both owner policies, one question: is this edition allowed by the owner's standing decision? (null = no)
async function ownerPolicyAllowed(edition, gateResult, template, deps) {
  return (await ownerApprovedEditionAllowed(edition, gateResult)) || (await ownerFooterEditionAllowed(edition, gateResult, template, deps));
}

async function ownerFooterEditionAllowed(edition, gateResult, template, deps) {
  if (!OWNER_FOOTER_EDITION_FORMS.has(edition.formCode)) return null;
  if (gateResult?.allowed || !(gateResult?.reasons || []).length || gateResult.reasons.some((reason) => reason !== GATE_REASONS.NO_POLICY)) return null;
  const footer = await (deps.footerEdition || defaultFooterEdition)(template);
  if (!footer || footer !== edition.editionIdentifier) return null;
  return { allowed: true, decision: "accepted", status: "owner_policy", reasons: [], ownerPolicy: "footer_edition", footerEdition: footer, decisionVersion: null };
}
const logger = () => require("../../utils/logger");

/** The edition a template stands for: { formCode, editionIdentifier | null, why } (null when the date is missing or cannot be trusted). */
function editionOf(template) {
  const formCode = template?.formCode;
  const editionIdentifier = isoDay(template?.editionDate);
  if (!formCode) return { formCode: String(formCode || ""), editionIdentifier: null, why: GATE_REASONS.INVALID_EDITION };
  if (!editionIdentifier) return { formCode, editionIdentifier: null, why: GATE_REASONS.INVALID_EDITION };
  if (template?.importMetadata?.editionDateSource === "version_backfill") return { formCode, editionIdentifier: null, why: "edition_date_untrusted" };
  return { formCode, editionIdentifier, why: null };
}

/**
 * Resolves with the gate result when the edition is accepted for filing; throws EditionPolicyHeldError otherwise (and on any internal error).
 * `template` needs { formCode, editionDate, importMetadata.editionDateSource }.
 */
async function requireAcceptedEdition(template, { entryPoint, actor } = {}) {
  let edition = { formCode: String(template?.formCode || ""), editionIdentifier: null };
  try {
    const deps = depsOverride || defaultDeps();
    edition = editionOf(template);
    if (!edition.editionIdentifier) throw new EditionPolicyHeldError({ formCode: edition.formCode, editionIdentifier: null, reasons: [edition.why], entryPoint });

    if (deps.autoEvidence) {
      try {
        await deps.service.runAutomaticCheck(edition.formCode, edition.editionIdentifier, { trigger: entryPoint });
      } catch (error) {
        // the automatic check can only ADD a decision; if it fails the persisted state decides (normally: held)
        logger().warn("form_edition_auto_check_failed", { formCode: edition.formCode, edition: edition.editionIdentifier, entryPoint, error: error.message });
      }
    }

    let result = await gate.check(edition.formCode, edition.editionIdentifier, { store: deps.store });
    const owner = result.allowed ? null : await ownerPolicyAllowed(edition, result, template, deps);
    if (owner) {
      result = owner;
      logger().info("form_edition_owner_policy_allowed", { formCode: edition.formCode, edition: edition.editionIdentifier, rule: owner.ownerPolicy, entryPoint });
    }
    if (!result.allowed) {
      logger().info("form_edition_policy_held", { formCode: edition.formCode, edition: edition.editionIdentifier, entryPoint, reasons: result.reasons });
      if (deps.service?.recordOutcome) await deps.service.recordOutcome({ formCode: edition.formCode, editionIdentifier: edition.editionIdentifier, outcome: result.decision === "not_accepted" ? "blocked" : "held", entryPoint, actor, reasons: result.reasons });
      throw new EditionPolicyHeldError({ formCode: edition.formCode, editionIdentifier: edition.editionIdentifier, reasons: result.reasons, entryPoint, decision: result.decision });
    }
    logger().info("form_edition_policy_allowed", { formCode: edition.formCode, edition: edition.editionIdentifier, entryPoint });
    if (deps.service?.recordOutcome) await deps.service.recordOutcome({ formCode: edition.formCode, editionIdentifier: edition.editionIdentifier, outcome: "gate_allowed", entryPoint, actor });
    return result;
  } catch (error) {
    if (error instanceof EditionPolicyHeldError) throw error;
    // fail closed: an error is a hold, never an allow
    throw new EditionPolicyHeldError({ formCode: edition.formCode, editionIdentifier: edition.editionIdentifier, reasons: [GATE_REASONS.GATE_ERROR], entryPoint });
  }
}

/**
 * READ-ONLY: what the gate answers for this edition right now ({ allowed, decision, reasons }). Never throws, never records an outcome, never runs the automatic check - it is for
 * previews (the Phase 3 ReleaseGate); every path that actually changes something calls requireAcceptedEdition above instead.
 */
async function peekAcceptance(template) {
  try {
    const deps = depsOverride || defaultDeps();
    const edition = editionOf(template);
    if (!edition.editionIdentifier) return { allowed: false, decision: "held", reasons: [edition.why] };
    const result = await gate.check(edition.formCode, edition.editionIdentifier, { store: deps.store });
    return result.allowed ? result : (await ownerPolicyAllowed(edition, result, template, deps)) || result;
  } catch {
    return { allowed: false, decision: "held", reasons: [GATE_REASONS.GATE_ERROR] }; // fail closed
  }
}

module.exports = { requireAcceptedEdition, peekAcceptance, EditionPolicyHeldError, editionOf, setDepsForTests };
