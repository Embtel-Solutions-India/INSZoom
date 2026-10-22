// Phase 3 ReleaseGate: ONE structured answer to "may this edition go live, and if not, why". It only COMBINES and ADDS to what Phases 0-2 already enforce (plan Rule C):
// nothing here weakens a check, and VersionManagementService.activate still runs the edition-acceptance enforcer itself (fail closed) after this passes.
//
//   decision      meaning
//   promote       every check passes: the edition may go live automatically
//   restricted_degraded   only NON-critical certification checks failed and an admin gave a written reason (audited); never for a critical failure or a non-accepted edition
//   approval_required     a material field change versus the previous edition has not been acknowledged by a person (the edition diff is attached)
//   held          USCIS's acceptance of this edition is not on record (or is stale / unverifiable); resolved by the automatic evidence check, never overridden
//   blocked       a critical failure, an edition USCIS does not accept, a deprecated edition, or a missing approval / mapping / certification
//
// Pure decision core (`decide`) + an `evaluate` that gathers the inputs. Dependencies are injectable so the whole matrix is testable without a database.
const { certificationDecision } = require("./certPolicy");
const autonomy = require("../../config/formPipelineAutonomy");

const ORDER = ["blocked", "held", "approval_required", "restricted_degraded", "promote"]; // most severe first

/** Pure. checks: [{ name, outcome: "pass" | "blocked" | "held" | "approval_required" | "degraded", detail }] -> the single most severe decision. */
function decide(checks = []) {
  const wanted = new Set(checks.map((check) => (check.outcome === "degraded" ? "restricted_degraded" : check.outcome === "pass" ? "promote" : check.outcome)));
  return ORDER.find((decision) => wanted.has(decision) && decision !== "promote") || "promote";
}

const approvedAndMapped = (template) => {
  if (!template.approvedAt || !template.approvedBy) return { name: "approved", outcome: "blocked", detail: "Approve the USCIS form edition before activation" };
  if (template.mappingStatus !== "active") return { name: "mapping_active", outcome: "blocked", detail: "Activate and validate the form mapping before activating this USCIS edition" };
  if (template.officialStatus === "deprecated") return { name: "not_deprecated", outcome: "blocked", detail: "A deprecated USCIS edition cannot be activated for new cases" };
  return { name: "preconditions", outcome: "pass", detail: "approved, mapping active, not deprecated" };
};

// a read-only preview through the enforcer's own boundary (activation itself calls requireAcceptedEdition, which also records the outcome)
const defaultPolicy = (template) => require("../form-edition-policy/EditionPolicyEnforcer").peekAcceptance(template);

async function defaultEditionDiff(template) {
  if (!template.parentVersion) return { blocked: false };
  const FormEditionComparisonService = require("../form-mapping/services/FormEditionComparisonService");
  const { blocked, comparison } = await FormEditionComparisonService.hasUnreviewedEditionChanges(template);
  return { blocked, summary: comparison?.summary || (comparison ? { breaking: Boolean(comparison.hasBreakingChanges) } : undefined) };
}

// Phase 7.4: the stored per-field inventory summary of the edition (written next to the coverage report on its active mapping VERSION, never on the template document).
// A light read; null when none has been computed for this edition yet.
async function defaultInventory(template) {
  const MappingVersion = require("../../models/USCISMappingVersion");
  const query = template.activeMappingVersionId ? { _id: template.activeMappingVersionId } : { template: template._id, status: "active" };
  const version = await MappingVersion.findOne(query).sort({ mappingVersion: -1 }).select("validation.coverage.inventory graph.inventory").lean();
  return version?.validation?.coverage?.inventory || version?.graph?.inventory || null;
}

/**
 * Phase 7.4 inventory check, behind FORM_PIPELINE_AUTONOMY: off = no check at all (the decision and the checks list are exactly what they always were); shadow = the would-be
 * decision is only logged; on = the check is added - in REPORT mode (FORM_INVENTORY_GATE, default) its outcome is "pass" with the would-be decision attached, so nothing is
 * blocked; with FORM_INVENTORY_GATE=enforce an edition with boxes that need a source is HELD. An unreadable inventory fails closed only in enforce mode.
 */
async function inventoryCheck(template, deps, mode) {
  const FieldInventory = require("../form-mapping/inventory/FieldInventory");
  const gate = FieldInventory.gateMode();
  try {
    const summary = await (deps.inventory || defaultInventory)(template);
    const check = FieldInventory.gateCheck(summary, { mode: gate });
    if (mode === "shadow") {
      require("../../utils/logger").warn("form_inventory_gate_shadow", { formCode: template?.formCode, wouldBe: check.wouldBe, gate, holdCount: check.holdCount ?? null });
      return null;
    }
    return check;
  } catch (error) {
    if (mode === "shadow") return null;
    return gate === "enforce"
      ? { name: "inventory", outcome: "held", wouldBe: "held", report: false, detail: `the per-field inventory could not be read (${error.message})` } // fail closed
      : { name: "inventory", outcome: "pass", wouldBe: "unknown", report: true, detail: `report only: the per-field inventory could not be read (${error.message})` };
  }
}

/**
 * Evaluates an edition. Never throws: an error inside a check is that check failing closed.
 * deps (tests): { policy(template), editionDiff(template), inventory(template) }
 * Returns { decision, canPromote, error, status, override, checks[] }; `error` / `status` carry the exact message and HTTP status activation should refuse with.
 */
async function evaluate(template, { req, deps = {} } = {}) {
  const checks = [];
  const pre = approvedAndMapped(template || {});
  checks.push(pre);

  const certification = certificationDecision(template, req);
  checks.push(certification.ok
    ? { name: "certification", outcome: certification.override ? "degraded" : "pass", detail: certification.override ? `non-critical check(s) overridden: ${certification.override.failed.join(", ")}` : "certified" }
    : { name: "certification", outcome: "blocked", detail: certification.error });

  try {
    const policy = await (deps.policy || defaultPolicy)(template);
    checks.push(policy.allowed
      ? { name: "edition_policy", outcome: "pass", detail: "USCIS acceptance of this edition is on record" }
      : { name: "edition_policy", outcome: policy.decision === "not_accepted" ? "blocked" : "held", detail: `USCIS acceptance not confirmed (${(policy.reasons || []).join(", ")})` });
  } catch (error) {
    checks.push({ name: "edition_policy", outcome: "held", detail: `acceptance could not be checked (${error.message})` }); // fail closed
  }

  try {
    const diff = await (deps.editionDiff || defaultEditionDiff)(template);
    checks.push(diff.blocked
      ? { name: "edition_diff", outcome: "approval_required", detail: "this edition changed fields that have mapping edges; a reviewer must acknowledge the edition diff", diff: diff.summary }
      : { name: "edition_diff", outcome: "pass", detail: template?.parentVersion ? "no unreviewed breaking change" : "first edition, nothing to compare" });
  } catch (error) {
    checks.push({ name: "edition_diff", outcome: "approval_required", detail: `the edition diff could not be read (${error.message})` }); // fail closed
  }

  const inventoryMode = autonomy.mode();
  if (inventoryMode !== "off") {
    const inventory = await inventoryCheck(template, deps, inventoryMode);
    if (inventory) checks.push(inventory);
  }

  const decision = decide(checks);
  const firstFailure = checks.find((check) => !["pass", "degraded"].includes(check.outcome));
  return {
    decision,
    canPromote: decision === "promote" || decision === "restricted_degraded",
    status: firstFailure ? 409 : undefined,
    error: firstFailure ? firstFailure.detail : undefined,
    override: certification.override,
    checks,
  };
}

module.exports = { evaluate, decide, ORDER };
