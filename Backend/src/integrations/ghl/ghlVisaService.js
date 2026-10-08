const logger = require("../../utils/logger");
const Case = require("../../models/Case");
const GHLIntegration = require("../../models/GHLIntegration");
const caseService = require("../../modules/cases/case.service");
const { getOpportunity } = require("./ghlOpportunityService");
const { ensureFieldIds } = require("./ghlCustomFieldService");
const env = require("../../config/env");
const { resolveVisa, defaultEntries, validateEntries, FIELD_KEYS, FIELD_NAMES } = require("./ghlVisaMapping");
const { provisionAfterVisaSelection } = require("./ghlVisaSelection.service");

// Glue between "what GHL says the visa is" and a case. Rules:
//  - Only a SINGLE-party visa is applied automatically in this phase. Employer and
//    family visas are recorded as a suggestion and flagged for a team lead, because
//    those cases need a different structure (added in a later phase).
//  - A visa is applied only while the case is still pending. A visa a person chose
//    is never overwritten by GHL.
//  - Failing to read or understand GHL never blocks creating or updating a case.

const SUGGESTION_ONLY = "structure_unsupported";

// The mapping table; seeded with today's GHL options the first time, and never
// overwritten afterwards (admins edit it).
// Configs already seeded during this process run: a bulk import calls ensureEntries once per opportunity and must not
// hit the database every time.
const seededConfigs = new WeakSet();

async function ensureEntries(config) {
  const existing = config?.visaMapping?.entries;
  if (existing?.length) return existing.map((e) => (e.toObject ? e.toObject() : e));
  if (config?.visaMapping?.seededAt) return []; // an admin deliberately emptied it
  const entries = defaultEntries();
  if (config && typeof config === "object") {
    if (seededConfigs.has(config)) return entries;
    seededConfigs.add(config);
  }
  if (config?._id) {
    await GHLIntegration.updateOne(
      { _id: config._id, "visaMapping.seededAt": { $exists: false } },
      { $set: { "visaMapping.entries": entries, "visaMapping.seededAt": new Date() } }
    ).catch(() => {});
  }
  return entries;
}

/**
 * Resolves the visa for an opportunity. Never throws.
 * Uses the custom fields already on the opportunity (search results carry them);
 * fetches the opportunity once if they are missing (some webhook payloads omit them).
 */
async function resolveForOpportunity({ opportunity, config, client, pipelineCategory }) {
  try {
    let customFields = opportunity?.customFields;
    if (!Array.isArray(customFields) && opportunity?.id) {
      const full = await getOpportunity(opportunity.id, client).catch(() => null);
      customFields = full?.customFields;
    }
    const [entries, fieldIds] = await Promise.all([ensureEntries(config), ensureFieldIds(config, { client })]);
    return resolveVisa({ customFields, fieldIds, entries, pipelineCategory });
  } catch (error) {
    logger.warn("ghl_visa_resolution_failed", { error: error.message });
    return { status: "unavailable", reason: "Could not read the visa information from GHL" };
  }
}

// What to do with a resolution: the case fields to set, the stored record, and why a human may be needed.
// `allowEmployer` is true only on the employer-intake path, where an employer visa becomes an employee card under
// an employer matter. For an existing individual card it stays false: an individual case is never converted.
function planFromResolution(resolution, { allowEmployer = false } = {}) {
  if (!resolution) return { applied: false, fields: {}, record: null, attention: [] };
  const mappedSingle = resolution.status === "mapped" && (resolution.structure === "single" || (allowEmployer && resolution.structure === "employer_employee"));
  const status = mappedSingle ? "applied" : resolution.status === "mapped" ? SUGGESTION_ONLY : resolution.status;
  const attention = [];
  if (resolution.status === "mapped" && !mappedSingle) {
    attention.push(`GHL says ${resolution.visaType}, an ${String(resolution.structure).replace("_", "/")} visa, but this card is an individual case. A team lead sets it up (individual cards are never converted automatically).`);
  }
  if (resolution.status === "ambiguous") attention.push(`GHL visa fields conflict: ${resolution.reason}`);
  if (resolution.categoryMismatch) attention.push(`The GHL pipeline and the visa (${resolution.visaType}) disagree on Immigrant vs Non-Immigrant.`);

  const record = {
    status,
    reason: resolution.reason,
    visaType: resolution.visaType,
    petitionSubType: resolution.petitionSubType,
    structure: resolution.structure,
    category: resolution.category,
    field: resolution.field,
    value: resolution.value,
    categoryMismatch: Boolean(resolution.categoryMismatch),
    resolvedAt: new Date(),
  };
  const fields = mappedSingle
    ? {
        visaType: resolution.visaType,
        visaCategory: resolution.visaType,
        petitionType: resolution.visaType,
        ...(resolution.petitionSubType ? { petitionSubType: resolution.petitionSubType } : {}),
        visaSelectionStatus: "selected",
      }
    : {};
  return { applied: mappedSingle, fields, record, attention };
}

// ---- provisioning (throttled) --------------------------------------------

// Setting up a visa-driven case (orchestration, forms, checklists) can be heavy,
// and a bulk import may apply many visas at once. Run at most two at a time,
// in the background, so the server and the board stay responsive.
const MAX_CONCURRENT = 2;
const waiting = [];
let active = 0;

function pump() {
  while (active < MAX_CONCURRENT && waiting.length) {
    const job = waiting.shift();
    active += 1;
    job()
      .catch((error) => logger.error("ghl_visa_provision_failed", { error: error.message }))
      .finally(() => {
        active -= 1;
        pump();
      });
  }
}

async function provisionVisaCase(caseId) {
  const caseDoc = await Case.findById(caseId);
  if (!caseDoc || caseDoc.visaSelectionStatus !== "selected") return;
  const lifecycle = require("../../modules/cases/case-lifecycle-orchestrator.service");
  const step = async (name, run) => {
    try {
      await run();
    } catch (error) {
      logger.error("ghl_visa_provision_step_failed", { caseId: String(caseId), step: name, error: error.message });
    }
  };
  // Same steps the existing "visa selected later" path runs, in the same order.
  await step("orchestrate", () => require("../../modules/cases/immigration-knowledge-engine.service").orchestrate(caseId, null, null, { reason: "case_initialized" }));
  const fresh = await Case.findById(caseId);
  if (fresh) await provisionAfterVisaSelection(fresh, null, null);
  await step("recalculate", () => lifecycle.recalculate(caseId, null, null, "ghl_visa_applied"));
}

function enqueue(task) {
  waiting.push(task);
  setImmediate(pump);
}

function scheduleProvisioning(caseId) {
  enqueue(() => module.exports.provisionVisaCase(caseId));
}

// Employer matter + employee card. Same steps the existing flows run (createCase's initialisation for the matter,
// addEmployeeSlot for each employee), each isolated so one failure never blocks the rest, and no notifications
// (intake already sent them).
async function provisionEmployerMatter({ principalId, childId, newPrincipal }) {
  const lifecycle = require("../../modules/cases/case-lifecycle-orchestrator.service");
  const step = async (name, run) => {
    try {
      await run();
    } catch (error) {
      logger.error("ghl_employer_provision_step_failed", { principalId: String(principalId), step: name, error: error.message });
    }
  };
  if (newPrincipal) await step("orchestrate employer", () => lifecycle.orchestrateOne(principalId, null, null));
  await step("orchestrate employee", () => lifecycle.orchestrateOne(childId, null, null));
  const principal = await Case.findById(principalId);
  if (!principal) return;
  await step("forms", () => lifecycle.provisionRequiredForms(principal, null, null));
  if (newPrincipal) await step("petition draft", () => lifecycle.provisionPetitionDraft(principal, null, null));
  await step("checklists", () => lifecycle.provisionChecklistAssignments(principal, null, null));
  await step("recalculate", () => lifecycle.recalculate(principalId, null, null, "ghl_employee_added"));
}

function scheduleEmployerProvisioning(args) {
  enqueue(() => module.exports.provisionEmployerMatter(args));
}

/**
 * For a case that already exists and is still waiting on a visa: apply a mapped
 * single-party visa from GHL. A no-op once anyone (or any earlier run) has set a
 * visa, so a human choice is never overwritten.
 */
async function applyToExistingCase(caseDoc, resolution) {
  const plan = planFromResolution(resolution);
  if (!plan.record) return { applied: false };
  const set = { "integrations.ghl.visaResolution": plan.record };
  if (plan.attention.length) set["integrations.ghl.flags.needsAttention"] = true;

  if (!plan.applied) {
    await Case.updateOne({ _id: caseDoc._id }, { $set: set });
    return { applied: false, status: plan.record.status };
  }
  for (const [key, value] of Object.entries(plan.fields)) set[key] = value;
  // Guard: only while still pending, so this can never overwrite a chosen visa.
  const result = await Case.updateOne({ _id: caseDoc._id, visaSelectionStatus: "pending" }, { $set: set });
  if (!result.matchedCount) return { applied: false, status: "already_set" };

  const fresh = await Case.findById(caseDoc._id);
  if (fresh) {
    caseService.addTimelineEvent(fresh, "case", "Visa set from GHL", `Service Type mapped to ${plan.fields.visaType}`, null, {
      source: "ghl",
      field: resolution.field,
      value: resolution.value,
    });
    await fresh.save().catch(() => {});
  }
  module.exports.scheduleProvisioning(caseDoc._id); // via exports so tests can observe it
  return { applied: true, status: "applied", visaType: plan.fields.visaType };
}

// ---- admin view / edit of the mapping table ------------------------------

async function getMappingView() {
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId });
  const entries = config ? await ensureEntries(config) : defaultEntries();
  const ids = config?.visaMapping?.fieldIds || {};
  return {
    configured: Boolean(config),
    entries,
    fields: FIELD_NAMES.map((name) => ({ name, fieldKey: FIELD_KEYS[name], resolved: Boolean(ids[name]) })),
    fieldIdsRefreshedAt: config?.visaMapping?.fieldIdsRefreshedAt || null,
  };
}

// Replaces the table. Validated first (known fields, real visa types and sub-types, no duplicates);
// nothing is saved unless every row is valid.
async function saveMapping(inputEntries) {
  const checked = validateEntries(inputEntries);
  if (!checked.ok) throw Object.assign(new Error(checked.errors.slice(0, 5).join("; ")), { status: 400, code: "INVALID_MAPPING", errors: checked.errors });
  const config = await GHLIntegration.findOne({ locationId: env.ghl.locationId });
  if (!config) throw Object.assign(new Error("Run the GHL setup first."), { status: 409 });
  config.set("visaMapping.entries", checked.entries);
  config.set("visaMapping.seededAt", config.visaMapping?.seededAt || new Date());
  await config.save();
  return { entries: checked.entries };
}

module.exports = {
  getMappingView,
  saveMapping,
  ensureEntries,
  resolveForOpportunity,
  planFromResolution,
  applyToExistingCase,
  scheduleProvisioning,
  scheduleEmployerProvisioning,
  provisionEmployerMatter,
  provisionVisaCase,
  SUGGESTION_ONLY,
  MAX_CONCURRENT,
};
