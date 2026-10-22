// The gate that decides whether AI mapping may move beyond SHADOW for a form. It is the ONLY thing the engine's "on" mode consults, and it fails CLOSED:
// a missing record, an unmet evaluation, an expired one, a golden set that changed or lost its sign-off, a changed prompt or model, a family that was never evaluated, or ANY
// error means "closed". Evaluating (evaluate.js) and recording (recordEvaluation) are separate from asking (isOpen), and nothing here ever opens the gate by itself.
const { SCOPE } = require("../../form-mapping/golden/buildDraft");

const DAY_MS = 24 * 60 * 60 * 1000;
const VALID_DAYS = () => Number(process.env.AI_MAPPING_GATE_VALID_DAYS || 30);

const defaultDeps = () => ({
  Record: require("../../../models/AiMappingGateRecord"),
  SignOff: require("../../../models/GoldenSetSignOff"),
  draft: () => require("../../form-mapping/golden/goldenSet.draft.json"),
  // what the engine is using RIGHT NOW: asked from the engine's OWN provider (the AI platform's active form_mapping prompt version and the model it is configured with), so the
  // gate and the engine can never disagree about what was evaluated. Unreadable => undefined => the gate is closed.
  current: async () => {
    const { createDefaultProvider, resolveAiUser } = require("../provider");
    const user = await resolveAiUser(null);
    if (!user) return {};
    const info = await createDefaultProvider().info(user);
    return { promptVersion: info?.promptVersion === undefined || info?.promptVersion === null ? undefined : String(info.promptVersion), model: info?.model ? String(info.model) : undefined };
  },
  now: () => new Date(),
});

/** The family of a form in the golden scope, or null. */
const familyOf = (formCode) => SCOPE[String(formCode || "").toUpperCase()]?.family || null;

function createAiMappingGate(overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };

  async function latest() {
    return deps.Record.findOne({}).sort({ evaluatedAt: -1 }).lean();
  }

  /** Stores an evaluation report (the output of evaluate()) as a new, permanent record. Append-only. */
  async function recordEvaluation(report, { by = "system", source = "shadow_store" } = {}) {
    const current = (await deps.current()) || {};
    if (!current.promptVersion || !current.model) throw Object.assign(new Error("the engine's prompt version / model could not be read, so an evaluation cannot be recorded"), { status: 409 });
    if (!report || typeof report.met !== "boolean" || !report.goldenChecksum) throw Object.assign(new Error("not an accuracy report"), { status: 400 });
    const { metrics, results, blockers, violations, evaluated, thresholds } = report;
    return deps.Record.create({
      evaluatedAt: deps.now(),
      source,
      by: String(by),
      met: report.met,
      thresholds,
      summary: { results, blockers, overall: metrics?.overall, byFamily: metrics?.byFamily, byKind: metrics?.byKind, precision: metrics?.precision, autoUsedText: metrics?.autoUsedText, violationTotals: { role: violations?.roleTotal ?? 0, integrity: violations?.integrityTotal ?? 0 } },
      promptVersion: current.promptVersion,
      model: current.model,
      goldenChecksum: report.goldenChecksum,
      families: evaluated?.families || [],
      forms: evaluated?.forms || [],
      expiresAt: new Date(deps.now().getTime() + VALID_DAYS() * DAY_MS),
    });
  }

  /** { open, reasons[] } for one form. Open only when EVERY condition holds; closed (with every reason found) otherwise. */
  async function isOpen({ formCode, family } = {}) {
    const reasons = [];
    try {
      const wantedFamily = family || familyOf(formCode);
      if (!wantedFamily) reasons.push("form_not_in_golden_scope");

      const record = await latest();
      if (!record) reasons.push("no_evaluation_on_record");
      else {
        if (record.met !== true) reasons.push("evaluation_not_met");
        if (!record.expiresAt || new Date(record.expiresAt).getTime() <= deps.now().getTime()) reasons.push("evaluation_expired");
        if (wantedFamily && !(record.families || []).includes(wantedFamily)) reasons.push("family_not_evaluated");
      }

      const draft = deps.draft();
      const signOff = await deps.SignOff.findOne({}).sort({ signedAt: -1 }).lean();
      if (!signOff) reasons.push("golden_set_not_signed_off");
      else if (signOff.entriesChecksum !== draft.entriesChecksum) reasons.push("golden_set_changed_since_sign_off");
      if (record && record.goldenChecksum !== draft.entriesChecksum) reasons.push("golden_set_changed_since_evaluation");

      let current = {};
      try { current = (await deps.current()) || {}; } catch { current = {}; }
      if (!current.promptVersion) reasons.push("prompt_version_unreadable");
      else if (record && String(record.promptVersion) !== String(current.promptVersion)) reasons.push("prompt_version_changed");
      if (!current.model) reasons.push("model_unreadable");
      else if (record && String(record.model) !== String(current.model)) reasons.push("model_changed");
    } catch (error) {
      reasons.push("gate_error"); // fail closed
    }
    const unique = [...new Set(reasons)];
    return { open: unique.length === 0, reasons: unique };
  }

  /** For the status screen: one answer per golden-scope family (the gate decides per family), plus a plain summary of the newest evaluation. Never throws; any error reads as closed. */
  async function status() {
    const families = {};
    for (const [code, scope] of Object.entries(SCOPE)) {
      if (families[scope.family]) continue;
      families[scope.family] = await isOpen({ formCode: code, family: scope.family });
    }
    let newest = null;
    try {
      const record = await latest();
      if (record) newest = { evaluatedAt: record.evaluatedAt, met: record.met === true, expiresAt: record.expiresAt, promptVersion: record.promptVersion, model: record.model, source: record.source, families: record.families || [], forms: record.forms || [], blockers: record.summary?.blockers || [], autoUsedText: record.summary?.autoUsedText, precision: record.summary?.precision };
    } catch { newest = null; }
    return { open: Object.values(families).some((family) => family.open), families, latest: newest };
  }

  return { isOpen, recordEvaluation, latest, status };
}

let shared = null;
const instance = () => (shared ||= createAiMappingGate());

module.exports = {
  createAiMappingGate, familyOf,
  isOpen: (args) => instance().isOpen(args),
  recordEvaluation: (report, options) => instance().recordEvaluation(report, options),
  latest: () => instance().latest(),
  status: () => instance().status(),
};
