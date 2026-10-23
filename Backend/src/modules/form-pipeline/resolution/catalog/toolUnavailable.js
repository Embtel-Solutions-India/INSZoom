// Phase 7.E catalog entry: the PDF normalizer tool (qpdf) could not be started. Ordered alternatives, each VERIFIED, each recorded by the resolver:
//   1. reprobe              forget every cached answer and look for the tool again (a process started before qpdf was installed heals here)
//   2. long_timeout_retry   probe again with a long timeout (a 15 s probe under load is not proof the tool is missing)
//   3. fresh_temp_dir_retry normalize again in a brand-new temp folder (separates a temp-file failure from a missing tool)
//   4. alternate_normalizer the pure-JavaScript normalizer, accepted only when it keeps the same pages and field names
// Contract (shared with the resolver): { id, description, matches(diagnosis, error, ctx), strategies: [{ id, description, safe, run(ctx), verify(ctx, runResult) }] }
// ctx = { job, stage, formCode, error, diagnosis, attempt, deps }. deps (all injectable; real ones are the defaults):
//   ensureQpdf({ force, deps }), works(binary), normalize(buffer), fallback { normalizeVerified, compareStructure }, loadInput() -> Buffer of the PDF being imported.

const real = {
  ensureQpdf: (options) => require("../../../../utils/ensureQpdf").ensureQpdf(options),
  works: (binary, options) => require("../../../../utils/ensureQpdf").works(binary, options),
  normalize: (buffer) => require("../../../../utils/normalizePdf").normalizePdf(buffer),
  fallback: () => require("../../../../utils/normalizeFallback"),
};

const dep = (ctx, name) => (ctx?.deps && ctx.deps[name]) || real[name];
const fallbackOf = (ctx) => (ctx?.deps?.fallback) || real.fallback();
const isPdf = (value) => Buffer.isBuffer(value) && value.subarray(0, 5).toString("utf8") === "%PDF-";

const reprobe = {
  id: "reprobe",
  description: "Look for the tool again from scratch, ignoring any cached answer and the configured path",
  safe: true,
  run: async (ctx) => {
    const binary = await dep(ctx, "ensureQpdf")({ force: true });
    return binary ? { ok: true, evidence: `found a working qpdf at "${binary}"`, retry: true, binary } : { ok: false, evidence: "no working qpdf found on the configured path, PATH or the usual locations" };
  },
  verify: async (ctx, result) => Boolean(result?.binary) && (await dep(ctx, "works")(result.binary)).ok === true,
};

const longTimeoutRetry = {
  id: "long_timeout_retry",
  description: "Probe again with a 5 minute timeout (a slow first start is not a missing tool)",
  safe: true,
  run: async (ctx) => {
    const binary = await dep(ctx, "ensureQpdf")({ force: true, deps: { timeout: 5 * 60 * 1000 } });
    return binary ? { ok: true, evidence: `qpdf answered within the long timeout at "${binary}"`, retry: true, binary } : { ok: false, evidence: "qpdf did not answer even with a 5 minute timeout" };
  },
  verify: async (ctx, result) => Boolean(result?.binary) && (await dep(ctx, "works")(result.binary, { timeout: 5 * 60 * 1000 })).ok === true,
};

const freshTempDirRetry = {
  id: "fresh_temp_dir_retry",
  description: "Normalize the PDF again in a brand-new temporary folder",
  safe: true,
  run: async (ctx) => {
    const input = ctx?.deps?.loadInput ? await ctx.deps.loadInput() : null;
    if (!isPdf(input)) return { ok: false, evidence: "the PDF being imported is not available to retry with" };
    try {
      const output = await dep(ctx, "normalize")(input);
      return isPdf(output) ? { ok: true, evidence: "normalizing succeeded in a fresh temporary folder", retry: true, output } : { ok: false, evidence: "the retry produced no PDF" };
    } catch (error) {
      return { ok: false, evidence: `retry failed: ${String(error.code || error.message).slice(0, 120)}` };
    }
  },
  verify: async (_ctx, result) => isPdf(result?.output),
};

const alternateNormalizer = {
  id: "alternate_normalizer",
  description: "Use the pure-JavaScript normalizer, accepted only when pages and field names are unchanged",
  safe: true,
  run: async (ctx) => {
    const input = ctx?.deps?.loadInput ? await ctx.deps.loadInput() : null;
    if (!isPdf(input)) return { ok: false, evidence: "the PDF being imported is not available to normalize" };
    try {
      const { buffer, report } = await fallbackOf(ctx).normalizeVerified(input);
      return { ok: true, evidence: `normalized without qpdf: ${report.pages} page(s), ${report.fields} field(s), same field names`, retry: true, output: buffer, report };
    } catch (error) {
      return { ok: false, evidence: `the JavaScript normalizer could not be used: ${String(error.code || error.message).slice(0, 160)}` };
    }
  },
  verify: async (ctx, result) => {
    if (!isPdf(result?.output)) return false;
    const input = ctx?.deps?.loadInput ? await ctx.deps.loadInput() : null;
    if (!isPdf(input)) return false;
    return (await fallbackOf(ctx).compareStructure(input, result.output)).ok === true;
  },
};

module.exports = {
  id: "tool_unavailable",
  description: "The PDF normalizer tool could not be started",
  matches: (diagnosis, error) => diagnosis?.cause === "tool_unavailable" || error?.cause === "tool_spawn" || error?.code === "QPDF_NOT_FOUND",
  strategies: [reprobe, longTimeoutRetry, freshTempDirRetry, alternateNormalizer],
};
