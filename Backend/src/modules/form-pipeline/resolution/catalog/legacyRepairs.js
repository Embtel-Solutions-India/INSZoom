// The Phase 4 repair strategies (renormalize_pdf, rediscover_components, clear_template_cache) as catalog entries, so the old repair step and the new engine are one
// mechanism. The runner passes the registered strategies as ctx.deps.legacyRepairs and a job context as ctx.legacyContext; each wrapper runs repair -> verify exactly as
// the old framework did and respects its per-job attempt limit.
const { LIMITS } = require("../../pipeline.constants");

const NAMES = ["renormalize_pdf", "rediscover_components", "clear_template_cache"];
const find = (ctx, name) => (ctx?.deps?.legacyRepairs || []).find((strategy) => strategy?.name === name);
const matchesAny = (ctx, error) => (ctx?.deps?.legacyRepairs || []).some((strategy) => { try { return strategy.matches(error); } catch { return false; } });

const wrap = (name) => ({
  id: `legacy_${name}`,
  description: `Phase 4 repair: ${name}`,
  safe: true,
  async run(ctx) {
    const strategy = find(ctx, name);
    if (!strategy) return { ok: false, evidence: "repair strategy not registered" };
    let applies = false;
    try { applies = strategy.matches(ctx.error); } catch { applies = false; }
    if (!applies) return { ok: false, evidence: "does not apply to this error" };
    const tried = (ctx.job?.repairsTried || []).filter((item) => item.strategy === name).length;
    if (tried >= LIMITS.repairAttemptsPerStrategy) return { ok: false, evidence: "already tried for this job" };
    const context = ctx.legacyContext || ctx;
    let verification = "";
    try {
      await strategy.repair(ctx.error, context);
      verification = String((await strategy.verify(ctx.error, context)) ?? "");
    } catch (error) {
      verification = `error: ${String(error?.message || error).slice(0, 160)}`;
    }
    const ok = Boolean(verification) && !/^fail|^error/i.test(verification);
    if (typeof ctx.deps.recordRepair === "function") await Promise.resolve(ctx.deps.recordRepair({ strategy: name, outcome: ok ? "repaired" : "failed", verification })).catch(() => null);
    return { ok, evidence: verification, retry: true };
  },
  async verify(_ctx, run) { return Boolean(run?.ok); },
});

module.exports = {
  id: "legacyRepairs",
  description: "the Phase 4 repair strategies",
  matches: (_diagnosis, error, ctx) => matchesAny(ctx, error),
  strategies: NAMES.map(wrap),
};
