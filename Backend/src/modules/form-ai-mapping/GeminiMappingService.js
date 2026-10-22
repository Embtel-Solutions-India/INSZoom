// Phase 4 Gemini mapping engine: suggestions for the boxes of a form edition, validated by code, tiered by risk, stored for review (shadow) and - only when the accuracy gate is open -
// the narrow auto_use tier written into a NEW mapping version of a PENDING edition (mode "on"). Plan Phase 4 + decisions 3 and 19.
//
// Hard rules, all enforced here or by the modules it uses:
//   - the model never activates anything and its score never decides anything (the score is stored for audit only);
//   - the prompt input is an ALLOW-LIST (promptInput.js): form / registry / checklist metadata, never a client answer, document, name, SSN or case data;
//   - a model candidate must come from the registry slice it was shown; it is then checked independently (candidateValidator.js) and tiered (riskTier.js);
//   - any failure - quota, outage, a bad answer - leaves the affected boxes needs_review and NEVER fails the pipeline; nothing deterministic depends on this file.
const logger = require("../../utils/logger");
const MappingGraphService = require("../form-mapping/services/MappingGraphService");
const { mode } = require("./mode");
const { parseModelOutput } = require("./schema");
const { liveRegistry, sliceFor, sha } = require("./registrySlice");
const { boxInput, buildBatchInput, assertAllowListed, inputHash, clean } = require("./promptInput");
const { validateCandidate } = require("./candidateValidator");
const { tierOf, riskFlags, kindOf, isRepeated } = require("./riskTier");
const { mongoStore } = require("./suggestionStore");
const { createDefaultProvider, resolveAiUser } = require("./provider");
const { corroborate } = require("./corroboration");

const num = (name, fallback) => Number(process.env[name] || fallback);
const LIMITS = () => ({ batchSize: num("FORM_AI_MAPPING_BATCH_SIZE", 20), concurrency: num("FORM_AI_MAPPING_CONCURRENCY", 2), maxBoxes: num("FORM_AI_MAPPING_MAX_BOXES", 400) });
const UNFILLABLE_TYPE = /signature|button|barcode|image/i;
const retryableError = (error) => error.retryable === true || error.status === 429 || error.status >= 500 || error.name === "AbortError";
const stopsTheRun = (error) => ["AI_BUDGET_EXCEEDED", "AI_USER_BUDGET_EXCEEDED", "AI_CREDENTIAL_MISSING", "AI_PROVIDER_UNAVAILABLE"].includes(error.code) || error.status === 429;

const editionChecksum = (template) => template.importMetadata?.checksum || template.lifecycle?.sourceChecksum || template.artifacts?.form?.checksum || "";
const stemOf = (field) => String(field.targetPdfField || "").split(".").pop().replace(/\[\d+\]$/, "");
const repeatIndexOf = (field) => { const match = /[A-Za-z_]([2-9])$/.exec(stemOf(field)); return match ? Number(match[1]) : undefined; };

// a label that is only the scanner's machine name carries no meaning for the model: the box needs a person, not a guess
function hasMeaningfulLabel(field) {
  const label = String(field.label || field.fieldLabel || "").trim();
  if (label.length < 3) return false;
  const machine = [field.normalizedName, field.fieldName, field.targetFieldId, field.targetPdfField].map((value) => String(value || "").toLowerCase());
  return !machine.includes(label.toLowerCase()) && !/^(form\s*\d|field\s*\d|text\s*field|check\s*box)/i.test(label);
}

/** Default checklist question loader: key, label, canonical path, type and option labels of the checklists that feed this form - never an answer. */
async function loadQuestions(template, { Trace = () => require("../form-mapping/services/ChecklistFieldTraceabilityService"), Question = () => require("../../models/Question"), limit = 600 } = {}) {
  const trace = Trace();
  const questions = [];
  for (const key of await trace.checklistKeysForForm(template.formCode)) {
    const { questionnaire, questions: resolved } = await trace.canonicalPathsForQuestionnaire(key);
    if (!questionnaire) continue;
    const rows = await Question().find({ questionnaire: questionnaire._id, active: { $ne: false } }).select("key type options").lean().catch(() => []);
    const byKey = new Map(rows.map((row) => [row.key, row]));
    for (const question of resolved) {
      const row = byKey.get(question.questionKey) || {};
      questions.push({ questionKey: question.questionKey, label: question.label, canonicalPath: question.canonicalPath, type: row.type, options: Array.isArray(row.options) ? row.options.map((option) => (typeof option === "object" ? option.label || option.value : option)) : undefined });
    }
  }
  return questions.slice(0, limit);
}

const questionnaireVersion = (questions) => sha(questions.map((q) => `${q.questionKey || q.key}|${q.canonicalPath || ""}|${q.type || ""}`).sort().join("\n")).slice(0, 16);

async function pool(items, size, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(size, 1), items.length) }, async () => {
    while (cursor < items.length) { const index = cursor; cursor += 1; results[index] = await worker(items[index], index); }
  }));
  return results;
}

/**
 * Suggestions for the boxes of one edition. Returns { mode, suggestions[], stats }. Never throws for a model / quota / outage problem (stats.retryLater says so).
 * deps (tests): { mode(), registry, questions(template), store, corroborate(args), universe, limits, now }.
 */
async function suggestForTemplate({ template, graph = null, fieldIds, provider = null, user = null, req = null, deps = {} }) {
  const currentMode = (deps.mode || mode)();
  const stats = { boxes: 0, askedBoxes: 0, cached: 0, missingLabel: 0, sensitive: 0, batches: 0, failedBatches: 0, answered: 0, unanswered: 0, invalidItems: 0, tiers: { auto_use: 0, needs_review: 0, rejected: 0 }, retryLater: false, errors: [] };
  if (currentMode === "off") return { mode: "off", suggestions: [], stats: { ...stats, skipped: "mode_off" } };

  const limits = { ...LIMITS(), ...(deps.limits || {}) };
  const store = deps.store || mongoStore;
  const registry = deps.registry || liveRegistry();
  const currentGraph = graph || (await MappingGraphService.loadCurrentGraph(template).catch(() => ({ edges: [] })));
  const edgesByTarget = new Map((currentGraph.edges || []).filter((edge) => edge.status === "active").map((edge) => [edge.targetFieldId, edge]));
  const keptBlank = new Set((currentGraph.keepBlank || []).map((entry) => entry.targetFieldId));
  const questions = await (deps.questions ? deps.questions(template) : loadQuestions(template)).catch((error) => { stats.errors.push({ code: "QUESTIONS_UNAVAILABLE", message: error.message }); return []; });
  const qVersion = questionnaireVersion(questions);
  const questionPaths = new Set(questions.map((question) => question.canonicalPath).filter(Boolean));
  let universe = deps.universe === undefined ? null : deps.universe;
  if (deps.universe === undefined) { try { universe = await require("../form-mapping/contract").loadPathUniverse(); } catch { universe = null; } }

  const ai = provider || createDefaultProvider();
  const actor = user?._id || provider ? user : await resolveAiUser(user);
  const info = (await (ai.info ? ai.info(actor) : Promise.resolve({})).catch((error) => { stats.errors.push({ code: error.code || "PROVIDER_INFO_FAILED", message: error.message }); stats.retryLater = true; return null; })) || {};
  const model = info.model || ai.model || "unknown";
  const promptVersion = Number(info.promptVersion || ai.promptVersion || 0);
  if (!info.model && !ai.model) return { mode: currentMode, suggestions: [], stats: { ...stats, skipped: "no_provider" } };

  // the boxes: every scanned box that can be filled, or just the ones asked for
  const all = MappingGraphService.getTemplateFields(template).filter((field) => !UNFILLABLE_TYPE.test(`${field.type} ${field.targetPdfField}`) && !/PDF417|barcode/i.test(field.targetPdfField));
  const wanted = fieldIds ? new Set(fieldIds) : null;
  const fields = all.filter((field) => !wanted || wanted.has(field.targetFieldId)).slice(0, limits.maxBoxes);
  stats.boxes = fields.length;
  const position = new Map(all.map((field, index) => [field.targetFieldId, index]));
  const suggestions = [];
  const base = (field, extra) => ({
    templateId: template._id, formCode: template.formCode, editionDate: template.editionDate, targetFieldId: field.targetFieldId, targetPdfField: field.targetPdfField, candidate: null, reasonCode: "none",
    labelEvidence: "", rawScore: 0, checks: {}, reasons: [], risks: [], corroboratedBy: null, existingEdge: null, registryVersion: registry.version, questionnaireSchemaVersion: qVersion, model, promptVersion, mode: currentMode, ...extra,
  });

  // 1. boxes with nothing to go on are needs_review WITHOUT asking the model
  const askable = [];
  for (const field of fields) {
    const neighbors = [-2, -1, 1, 2].map((delta) => all[(position.get(field.targetFieldId) ?? -10) + delta]).filter((other) => other && other.section === field.section).map((other) => other.label);
    const box = boxInput(field, { neighbors, repeated: isRepeated(field), repeatIndex: repeatIndexOf(field) });
    if (!box) { stats.sensitive += 1; suggestions.push({ ...base(field, { tier: "needs_review", reasons: ["sensitive_looking_text"], inputHash: sha(`sensitive|${field.targetFieldId}`).slice(0, 40) }), transient: true }); continue; }
    if (!hasMeaningfulLabel(field)) { stats.missingLabel += 1; const tier = tierOf({ box: field, missingLabel: true }); suggestions.push(base(field, { ...tier, inputHash: inputHash({ editionChecksum: editionChecksum(template), box, registryVersion: registry.version, questionnaireSchemaVersion: qVersion, promptVersion, model }) })); continue; }
    askable.push({ field, box, hash: inputHash({ editionChecksum: editionChecksum(template), box, registryVersion: registry.version, questionnaireSchemaVersion: qVersion, promptVersion, model }) });
  }

  // 2. the cache: the same edition + box + inputs + prompt + model is never asked twice
  const cached = await store.findCached(template._id, askable.map((entry) => entry.hash)).catch(() => new Map());
  const toAsk = [];
  for (const entry of askable) {
    const hit = cached.get(`${entry.field.targetFieldId}|${entry.hash}`);
    if (hit) { stats.cached += 1; suggestions.push({ ...hit, cacheHit: true }); } else toAsk.push(entry);
  }
  stats.askedBoxes = toAsk.length;

  // 3. batches, bounded concurrency
  const batches = [];
  for (let index = 0; index < toAsk.length; index += limits.batchSize) batches.push(toAsk.slice(index, index + limits.batchSize));
  let stopped = null;
  await pool(batches, limits.concurrency, async (batch) => {
    if (stopped) { batch.forEach((entry) => suggestions.push({ ...base(entry.field, { tier: "needs_review", reasons: ["not_asked_run_stopped"], inputHash: entry.hash }), transient: true })); return; }
    stats.batches += 1;
    const slice = sliceFor(batch.map((entry) => [entry.box.label, entry.box.section, entry.box.pdfName, ...(entry.box.neighbors || [])].join(" ")), registry);
    const slicePaths = new Set(slice.map((entry) => entry.path));
    let answer;
    try {
      const input = buildBatchInput({ template, boxes: batch.map((entry) => entry.box), registry: slice, questions, purpose: "Map each box of this USCIS form to one canonical data field.", caseTypes: template.visaTypes || [] });
      assertAllowListed(input);
      answer = await ai.suggest(input, { user: actor, req });
    } catch (error) {
      stats.failedBatches += 1;
      stats.errors.push({ code: error.code || error.name || "AI_BATCH_FAILED", message: String(error.message).slice(0, 200) });
      if (retryableError(error) || stopsTheRun(error)) stats.retryLater = true;
      if (stopsTheRun(error)) stopped = error.code || "quota";
      batch.forEach((entry) => suggestions.push({ ...base(entry.field, { tier: "needs_review", reasons: ["no_model_answer"], inputHash: entry.hash }), transient: true }));
      return;
    }
    const parsed = parseModelOutput(answer?.data);
    if (!parsed.ok) {
      stats.failedBatches += 1; stats.retryLater = true; stats.errors.push({ code: "AI_ANSWER_INVALID", message: parsed.error });
      batch.forEach((entry) => suggestions.push({ ...base(entry.field, { tier: "needs_review", reasons: ["model_answer_invalid"], inputHash: entry.hash }), transient: true }));
      return;
    }
    stats.invalidItems += parsed.rejected.length;
    const byField = new Map();
    parsed.items.forEach((item) => { byField.set(item.fieldId, [...(byField.get(item.fieldId) || []), item]); });
    for (const entry of batch) {
      const items = byField.get(entry.field.targetFieldId) || [];
      const extra = { inputHash: entry.hash, model: answer.model || model, promptVersion: Number(answer.promptVersion || promptVersion) };
      if (!items.length) { stats.unanswered += 1; suggestions.push({ ...base(entry.field, { tier: "needs_review", reasons: [parsed.rejected.some((r) => r.fieldId === entry.field.targetFieldId) ? "model_item_invalid" : "no_answer_for_box"], ...extra }), transient: true }); continue; }
      stats.answered += 1;
      const distinct = [...new Set(items.map((item) => item.candidatePath))];
      if (distinct.length > 1) { suggestions.push(base(entry.field, { tier: "needs_review", reasons: ["conflicting_candidates"], checks: { candidates: { ok: false, detail: distinct.join(" | ") } }, ...extra })); continue; }
      const item = items[0];
      const validation = validateCandidate({ box: { ...entry.field, ...entry.box, neighbors: entry.box.neighbors }, item, ctx: { registry, slicePaths, edgesByTarget, questionPaths, universe, keptBlank } });
      const registryEntry = item.candidatePath ? registry.entries.get(item.candidatePath) : null;
      const candidate = registryEntry ? { path: registryEntry.path, type: registryEntry.type, role: registryEntry.role, cardinality: registryEntry.cardinality } : null;
      let corroboration = null;
      if (candidate && !validation.hard.length && riskFlags(entry.field, candidate).length) corroboration = await (deps.corroborate || corroborate)({ formCode: template.formCode, field: entry.field, candidatePath: candidate.path });
      const tier = tierOf({ box: entry.field, candidate, validation, corroboration });
      suggestions.push(base(entry.field, { candidate: candidate || (item.candidatePath ? { path: item.candidatePath, rejected: true } : null), reasonCode: item.reasonCode, labelEvidence: item.labelEvidence, rawScore: item.score, checks: validation.checks, existingEdge: validation.existingEdge, tier: tier.tier, reasons: tier.reasons, risks: tier.risks, corroboratedBy: tier.corroboratedBy, corroboration: corroboration ? { source: corroboration.source, path: corroboration.path, transform: corroboration.transform, condition: corroboration.condition } : null, ...extra }));
    }
  });
  suggestions.forEach((suggestion) => { stats.tiers[suggestion.tier] += 1; });

  // 4. store (immutable rows; the same edition + box + inputs is written once). A failed or unanswered box is NOT stored, so the next run asks again.
  try { stats.saved = (await store.saveMany(suggestions)).saved; } catch (error) { stats.errors.push({ code: "STORE_FAILED", message: error.message }); stats.retryLater = true; }
  return { mode: currentMode, suggestions, stats };
}

const defaultTransform = (kind) => (kind === "date" ? { type: "date", format: "mm/dd/yyyy" } : kind === "phone" ? { type: "phone" } : { type: "direct" });

/** Is the accuracy gate open for this form? Fork B's gate, loaded lazily; a missing module, an error or anything but an explicit open is CLOSED. */
async function gateOpen(formCode, family, deps = {}) {
  try {
    const gate = deps.gate || require("./accuracy/AiMappingGate");
    const result = await gate.isOpen({ formCode, family });
    return { open: result?.open === true, reasons: result?.reasons || [] };
  } catch (error) {
    return { open: false, reasons: [`gate unavailable: ${error.message}`] };
  }
}

/**
 * Mode "on" only: writes the auto_use suggestions of a PENDING edition into a NEW mapping version. Only boxes with no active edge; never an existing edge; never a live edition;
 * never an exclusive (rule-complete) form; never while the gate is closed; never if it would make a ready mapping not ready. Activation stays with the normal gates.
 */
async function applyAutoUse({ template, suggestions, graph = null, user, req, deps = {} }) {
  const currentMode = (deps.mode || mode)();
  const skipped = (reason, extra = {}) => ({ applied: 0, skipped: reason, ...extra });
  if (currentMode !== "on") return skipped("mode_not_on");
  if (template.status === "active") return skipped("live_edition_is_never_changed");
  if ((deps.exclusiveForms || require("../form-mapping/config/partyFieldRules").EXCLUSIVE_FORMS).has(template.formCode)) return skipped("exclusive_form");
  const { SCOPE } = require("../form-mapping/golden/buildDraft");
  const gate = await gateOpen(template.formCode, SCOPE[template.formCode]?.family || null, deps);
  if (!gate.open) return skipped("gate_closed", { reasons: gate.reasons });

  const base = graph || (await MappingGraphService.loadCurrentGraph(template));
  const taken = new Set((base.edges || []).filter((edge) => edge.status === "active").map((edge) => edge.targetFieldId));
  const blank = new Set((base.keepBlank || []).map((entry) => entry.targetFieldId));
  const fields = new Map(MappingGraphService.getTemplateFields(template).map((field) => [field.targetFieldId, field]));
  const eligible = suggestions.filter((s) => s.tier === "auto_use" && !s.transient && s.candidate?.path && !taken.has(s.targetFieldId) && !blank.has(s.targetFieldId) && fields.has(s.targetFieldId));
  if (!eligible.length) return skipped("nothing_eligible");

  const version = template.version || String(template.editionDate || "unknown");
  const edges = eligible.map((s) => {
    const field = fields.get(s.targetFieldId);
    const kind = kindOf(field);
    return {
      mappingId: `${template.formCode}:${version}:${s.targetFieldId}`, formCode: template.formCode, editionDate: template.editionDate, version, sourcePath: s.candidate.path, sourceType: "canonical",
      targetFieldId: s.targetFieldId, targetPdfField: s.targetPdfField, targetLabel: field.label, targetType: field.type, section: field.section, pageNumber: field.pageNumber,
      mappingType: kind === "date" ? "date" : ["checkbox", "radio"].includes(kind) ? "checkbox" : "direct", confidence: 80, status: "active",
      transform: s.corroboration?.transform || defaultTransform(kind), ...(s.corroboration?.condition ? { condition: s.corroboration.condition } : {}),
      note: `Gemini suggestion, validated (${s.reasonCode}${s.corroboratedBy ? `, corroborated by ${s.corroboratedBy}` : ""})`,
      profileOwner: String(s.candidate.path).startsWith("petitioner") ? "employer" : "employee", allowsOccurrenceOverride: false, origin: "ai",
      evidence: { aiValidated: true, tier: "auto_use", model: s.model, promptVersion: s.promptVersion, registryVersion: s.registryVersion, rawScore: s.rawScore, reasonCode: s.reasonCode, labelEvidence: s.labelEvidence, corroboratedBy: s.corroboratedBy || null },
      createdAt: new Date(),
    };
  });
  const known = new Set(((base.nodes || {}).canonical || []).map((node) => node.path));
  const next = { ...base, nodes: { ...(base.nodes || {}), canonical: [...((base.nodes || {}).canonical || []), ...[...new Set(edges.map((edge) => edge.sourcePath))].filter((path) => !known.has(path)).map((path) => ({ id: `canonical:${path}`, path, label: path, type: "text" }))] }, edges: [...(base.edges || []), ...edges] };

  // never make a ready mapping not ready, never store an invalid graph
  const before = await MappingGraphService.validateWithContract(base, template);
  const after = await MappingGraphService.validateWithContract(next, template);
  if (!after.valid) return skipped("graph_would_be_invalid", { errors: (after.errors || []).slice(0, 3) });
  if (before.readyForActivation && !after.readyForActivation) return skipped("would_make_a_ready_mapping_not_ready");
  next.validation = after;
  const saved = await MappingGraphService.persistVersion(template, next, user);
  let activated = false;
  if (after.readyForActivation) { await MappingGraphService.activate(template._id, user, req); activated = true; } // the NORMAL activation gates (readiness, edition diff)
  await (deps.store || mongoStore).markApplied(template._id, eligible.map((s) => s.targetFieldId), saved.mappingVersion).catch(() => null);
  return { applied: edges.length, mappingVersion: saved.mappingVersion, activated };
}

/**
 * The pipeline stage "ai_map": suggestions for the boxes the rules left unmapped (shadow stores them; on also applies the auto_use tier). Any failure is a skipped stage.
 */
async function runForTemplate({ template, user, req, deps = {} }) {
  const currentMode = (deps.mode || mode)();
  if (currentMode === "off") return { mode: "off" };
  if ((deps.exclusiveForms || require("../form-mapping/config/partyFieldRules").EXCLUSIVE_FORMS).has(template.formCode)) return { mode: currentMode, skipped: "exclusive_form" };
  const actor = await resolveAiUser(user);
  if (!actor && !deps.provider) return { mode: currentMode, skipped: "no_ai_user" };
  const graph = await MappingGraphService.loadCurrentGraph(template).catch(() => ({ edges: [] }));
  const mapped = new Set((graph.edges || []).filter((edge) => edge.status === "active").map((edge) => edge.targetFieldId));
  const unmapped = MappingGraphService.getTemplateFields(template).filter((field) => !mapped.has(field.targetFieldId)).map((field) => field.targetFieldId);
  if (!unmapped.length) return { mode: currentMode, skipped: "nothing_unmapped" };
  const result = await suggestForTemplate({ template, graph, fieldIds: unmapped, provider: deps.provider || null, user: actor, req, deps });
  const summary = { mode: currentMode, stats: result.stats, applied: null };
  if (currentMode === "on") summary.applied = await applyAutoUse({ template, suggestions: result.suggestions, graph, user: actor, req, deps }).catch((error) => { logger.warn("form_ai_mapping_apply_failed", { formCode: template.formCode, error: error.message }); return { applied: 0, skipped: "apply_failed", error: error.message }; });
  logger.info("form_ai_mapping_run", { formCode: template.formCode, mode: currentMode, tiers: result.stats.tiers, cached: result.stats.cached, failedBatches: result.stats.failedBatches, applied: summary.applied?.applied || 0 });
  return summary;
}

module.exports = { suggestForTemplate, applyAutoUse, runForTemplate, gateOpen, loadQuestions, hasMeaningfulLabel, clean };
