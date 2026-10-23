// Phase 7.E - the resolver. Given a failure it: diagnoses it, tries the stored solution for that signature FIRST, then the matching catalog strategies in order, then the
// generic portfolio (Discovery). Every attempt is time-boxed, VERIFIED (a strategy that "worked" but does not verify is an unsuccessful attempt), recorded, and never
// throws. The first strategy that runs ok AND verifies resolves the failure and is stored as the solution of that signature.
//
//   resolve({ error, stage, job, ctx }) -> { outcome: "resolved" | "exhausted" | "not_applicable", retry, diagnosis, attempts: [{ strategy, ok, verified, evidence, ms }] }
//   plan({ error, stage, job, ctx })    -> { diagnosis, planned: [strategyId] }   (what resolve WOULD try; runs nothing - used by the shadow mode)
//
// not_applicable: the failure is one no automatic action may touch (a programming error in our own code, an edition-policy hold, a lost lease, a mapping contract
// violation: see repair/guard.js). exhausted: every alternative was tried and none verified (or there was nothing to try).
const { diagnose } = require("./Diagnoser");
const { createDiscovery } = require("./Discovery");
const { refuses } = require("../repair/guard");

const DEFAULT_TIMEOUT_MS = 60000;
const clip = (value, max = 240) => String(value ?? "").replace(/\s+/g, " ").slice(0, max);

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms} ms`), { code: "RESOLUTION_TIMEOUT" })), ms); });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function createResolver({ catalog = [], store = null, log = { info() {}, warn() {} }, now = () => Date.now(), diagnoseDeps = {} } = {}) {
  const entries = catalog.filter((entry) => entry && Array.isArray(entry.strategies));
  const generic = entries.find((entry) => entry.id === "generic") || null;
  const discovery = createDiscovery({ generic, store });
  const allStrategies = new Map();
  for (const entry of entries) for (const strategy of entry.strategies) if (strategy?.id && !allStrategies.has(strategy.id)) allStrategies.set(strategy.id, strategy);

  const fullCtx = (base, diagnosis, error, stage, job) => ({ job, stage, formCode: job?.formCode, error, diagnosis, attempt: Number(job?.attempts || 1), deps: {}, ...base });
  const matchingEntries = (diagnosis, error, ctx) => entries.filter((entry) => {
    if (entry.id === "generic") return false; // the portfolio is Discovery's, never matched directly
    try { return Boolean(entry.matches?.(diagnosis, error, ctx)); } catch { return false; }
  });

  /** The ordered strategies for a failure, with where each came from: stored solution first, then catalog, then discovery. */
  async function ordered(diagnosis, error, ctx) {
    const list = [];
    const seen = new Set();
    const add = (strategy, source) => { if (strategy && !seen.has(strategy.id)) { seen.add(strategy.id); list.push({ strategy, source }); } };
    let stored = null;
    if (store) stored = await Promise.resolve(store.best(diagnosis.signature)).catch(() => null);
    if (stored && allStrategies.has(stored.strategyId)) add(allStrategies.get(stored.strategyId), "stored");
    for (const entry of matchingEntries(diagnosis, error, ctx)) for (const strategy of entry.strategies) add(strategy, "catalog");
    return { list, seen, stored };
  }

  async function plan({ error, stage = null, job = null, ctx = {} } = {}) {
    const diagnosis = diagnose({ error, stage, job, deps: diagnoseDeps });
    const full = fullCtx(ctx, diagnosis, error, stage, job);
    if (diagnosis.cause === "programming_error" || refuses(error)) return { diagnosis, planned: [] };
    const { list, seen } = await ordered(diagnosis, error, full);
    const extra = await discovery.strategiesFor(stage, [...seen]);
    return { diagnosis, planned: [...list.map((item) => item.strategy.id), ...extra.map((strategy) => strategy.id)] };
  }

  async function attemptOne(entry, full, timeoutMs) {
    const { strategy, source } = entry;
    const started = now();
    const attempt = { strategy: strategy.id, source, ok: false, verified: false, evidence: "", ms: 0 };
    let run = null;
    try {
      run = await withTimeout(strategy.run(full), timeoutMs, `strategy ${strategy.id}`);
      attempt.ok = Boolean(run?.ok);
      attempt.evidence = clip(run?.evidence);
      if (attempt.ok) {
        const verified = await withTimeout(strategy.verify ? strategy.verify(full, run) : true, timeoutMs, `verify ${strategy.id}`);
        attempt.verified = Boolean(verified);
        if (!attempt.verified) attempt.evidence = clip(`${attempt.evidence} (not verified)`);
      }
    } catch (error) {
      attempt.ok = false;
      attempt.evidence = clip(`threw: ${error?.message || error}`);
    }
    attempt.ms = Math.max(0, now() - started);
    return { attempt, run };
  }

  async function resolve({ error, stage = null, job = null, ctx = {} } = {}) {
    const diagnosis = diagnose({ error, stage, job, deps: diagnoseDeps });
    const result = { outcome: "exhausted", retry: false, diagnosis, attempts: [] };
    try {
      if (diagnosis.cause === "programming_error" || refuses(error)) return { ...result, outcome: "not_applicable" };
      const full = fullCtx(ctx, diagnosis, error, stage, job);
      const timeoutMs = Number(full.timeoutMs) > 0 ? Number(full.timeoutMs) : DEFAULT_TIMEOUT_MS;
      const { list, seen } = await ordered(diagnosis, error, full);
      const queue = [...list];
      let discoveryAdded = false;
      if (!queue.length) { // nothing matched this failure: go straight to the generic portfolio
        discoveryAdded = true;
        for (const strategy of await discovery.strategiesFor(stage, [...seen])) queue.push({ strategy, source: "discovery" });
      }
      for (let index = 0; index < queue.length; index += 1) {
        const item = queue[index];
        const { attempt, run } = await attemptOne(item, full, timeoutMs);
        result.attempts.push(attempt);
        const success = attempt.ok && attempt.verified;
        if (store) {
          if (success) await Promise.resolve(store.recordSuccess({ signature: diagnosis.signature, strategyId: item.strategy.id, stage, cause: diagnosis.cause, formCode: job?.formCode })).catch(() => null);
          else if (item.source === "stored") await Promise.resolve(store.recordFailure({ signature: diagnosis.signature, strategyId: item.strategy.id })).catch(() => null);
        }
        if (success) return { ...result, outcome: "resolved", retry: Boolean(run?.retry) };
        // the catalog (and the stored solution) did not solve it: bring in the generic portfolio once, best past performer first
        if (index === queue.length - 1 && !discoveryAdded) {
          discoveryAdded = true;
          for (const strategy of await discovery.strategiesFor(stage, [...queue.map((entry) => entry.strategy.id), ...seen])) queue.push({ strategy, source: "discovery" });
        }
      }
      return result;
    } catch (error2) {
      log.warn("form_pipeline_resolver_failed", { error: clip(error2?.message) });
      return result; // exhausted with what was recorded; the resolver itself never throws into the pipeline
    }
  }

  return { resolve, plan, diagnose: (input) => diagnose({ ...input, deps: diagnoseDeps }), strategyIds: () => [...allStrategies.keys()] };
}

module.exports = { createResolver, withTimeout, DEFAULT_TIMEOUT_MS };
